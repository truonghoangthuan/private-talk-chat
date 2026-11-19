use std::num::NonZeroUsize;
use std::sync::Mutex;

use lru::LruCache;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_CACHE_ENTRIES: usize = 64;
const MAX_CACHE_BYTES: usize = 150 * 1024 * 1024; // 150 MiB ceiling

#[derive(Clone)]
pub struct MediaCacheEntry {
    pub mime_type: String,
    pub bytes: Zeroizing<Vec<u8>>,
}

struct InnerCache {
    lru: LruCache<String, MediaCacheEntry>,
    total_bytes: usize,
}

/// Thread-safe in-memory LRU cache for decrypted media served via `privatetalk-media://`.
/// Uses `Zeroizing<Vec<u8>>` so evicted or cleared entries zero memory on drop.
pub struct DecryptedMediaCache {
    inner: Mutex<InnerCache>,
}

impl Default for DecryptedMediaCache {
    fn default() -> Self {
        Self::new()
    }
}

impl DecryptedMediaCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(InnerCache {
                lru: LruCache::new(NonZeroUsize::new(MAX_CACHE_ENTRIES).expect("non-zero")),
                total_bytes: 0,
            }),
        }
    }

    pub fn cache_key(conversation_id: Uuid, message_id: Uuid) -> String {
        format!("{conversation_id}/{message_id}")
    }

    pub fn insert(
        &self,
        conversation_id: Uuid,
        message_id: Uuid,
        mime_type: String,
        bytes: Zeroizing<Vec<u8>>,
    ) {
        let key = Self::cache_key(conversation_id, message_id);
        let entry_size = bytes.len();
        if entry_size > MAX_CACHE_BYTES {
            return;
        }

        let mut guard = self.inner.lock().expect("media cache mutex");
        if let Some(prev) = guard.lru.pop(&key) {
            guard.total_bytes = guard.total_bytes.saturating_sub(prev.bytes.len());
        }

        while guard.total_bytes + entry_size > MAX_CACHE_BYTES {
            if let Some((_, evicted)) = guard.lru.pop_lru() {
                guard.total_bytes = guard.total_bytes.saturating_sub(evicted.bytes.len());
            } else {
                break;
            }
        }

        guard.total_bytes += entry_size;
        guard.lru.put(key, MediaCacheEntry { mime_type, bytes });
    }

    pub fn get(&self, conversation_id: Uuid, message_id: Uuid) -> Option<MediaCacheEntry> {
        let key = Self::cache_key(conversation_id, message_id);
        let mut guard = self.inner.lock().expect("media cache mutex");
        guard.lru.get(&key).cloned()
    }

    pub fn remove(&self, conversation_id: Uuid, message_id: Uuid) {
        let key = Self::cache_key(conversation_id, message_id);
        let mut guard = self.inner.lock().expect("media cache mutex");
        if let Some(removed) = guard.lru.pop(&key) {
            guard.total_bytes = guard.total_bytes.saturating_sub(removed.bytes.len());
        }
    }

    pub fn clear(&self) {
        let mut guard = self.inner.lock().expect("media cache mutex");
        guard.lru.clear();
        guard.total_bytes = 0;
    }

    pub fn total_bytes(&self) -> usize {
        let guard = self.inner.lock().expect("media cache mutex");
        guard.total_bytes
    }
}

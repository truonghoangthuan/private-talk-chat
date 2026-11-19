use super::{SupabaseClient, SupabaseError};

impl SupabaseClient {
    pub async fn upload_storage_object(
        &self,
        access_token: &str,
        bucket: &str,
        object_path: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let url = format!("{}/storage/v1/object/{}/{}", cfg.url, bucket, object_path);
            let resp = self
                .http
                .post(&url)
                .header("apikey", &cfg.anon_key)
                .header("x-upsert", "true")
                .header("Content-Type", content_type)
                .bearer_auth(access_token)
                .body(bytes)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::InvalidResponse);
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        match bucket {
            "avatars" => {
                store.avatars.insert(object_path.to_string(), bytes);
            }
            "chat-media" => {
                store.chat_media.insert(object_path.to_string(), bytes);
            }
            _ => return Err(SupabaseError::NotFound("bucket")),
        }
        Ok(())
    }

    pub async fn download_storage_object(
        &self,
        access_token: &str,
        bucket: &str,
        object_path: &str,
    ) -> Result<Vec<u8>, SupabaseError> {
        if let Some(cfg) = &self.config {
            let url = format!("{}/storage/v1/object/{}/{}", cfg.url, bucket, object_path);
            let resp = self
                .http
                .get(&url)
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() {
                return Err(SupabaseError::NotFound("storage object"));
            }
            return resp
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|_| SupabaseError::NetworkError);
        }

        let store = self.local_store.lock().expect("local store lock");
        match bucket {
            "avatars" => store
                .avatars
                .get(object_path)
                .cloned()
                .ok_or(SupabaseError::NotFound("avatar")),
            "chat-media" => store
                .chat_media
                .get(object_path)
                .cloned()
                .ok_or(SupabaseError::NotFound("media object")),
            _ => Err(SupabaseError::NotFound("bucket")),
        }
    }

    pub async fn delete_storage_object(
        &self,
        access_token: &str,
        bucket: &str,
        object_path: &str,
    ) -> Result<(), SupabaseError> {
        if let Some(cfg) = &self.config {
            let url = format!("{}/storage/v1/object/{}/{}", cfg.url, bucket, object_path);
            let resp = self
                .http
                .delete(&url)
                .header("apikey", &cfg.anon_key)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|_| SupabaseError::NetworkError)?;
            if !resp.status().is_success() && resp.status().as_u16() != 404 {
                return Err(SupabaseError::NetworkError);
            }
            return Ok(());
        }

        let mut store = self.local_store.lock().expect("local store lock");
        match bucket {
            "avatars" => {
                store.avatars.remove(object_path);
            }
            "chat-media" => {
                store.chat_media.remove(object_path);
            }
            _ => {}
        }
        Ok(())
    }
}

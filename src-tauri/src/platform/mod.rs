pub mod dpapi;
pub mod notifications;
pub mod taskbar;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("DPAPI protection failed")]
    DpapiProtectFailed,
    #[error("DPAPI unprotection failed")]
    DpapiUnprotectFailed,
    #[error("session storage error")]
    IoError,
    #[error("taskbar COM update failed")]
    TaskbarError,
    #[error("notification error")]
    NotificationError,
}

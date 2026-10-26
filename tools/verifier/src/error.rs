#[derive(Debug, Clone)]
pub struct VerifyError {
    pub code: &'static str,
    pub detail: String,
}

impl VerifyError {
    pub fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

pub type VerifyResult<T> = Result<T, VerifyError>;

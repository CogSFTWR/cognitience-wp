//! Local filesystem document store.
//! Each document is a JSON file under the data directory — never leaves the machine.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub html: String,
    pub starred: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMeta {
    pub id: String,
    pub title: String,
    pub starred: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveDocument {
    pub title: Option<String>,
    pub html: Option<String>,
    pub starred: Option<bool>,
}

#[derive(Debug)]
pub enum StoreError {
    NotFound,
    InvalidId,
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "not found"),
            Self::InvalidId => write!(f, "invalid id"),
            Self::Io(e) => write!(f, "io: {e}"),
            Self::Json(e) => write!(f, "json: {e}"),
        }
    }
}

impl std::error::Error for StoreError {}

pub struct DocumentStore {
    root: PathBuf,
    lock: Mutex<()>,
}

impl DocumentStore {
    pub fn open(root: PathBuf) -> Result<Self, StoreError> {
        fs::create_dir_all(&root).map_err(StoreError::Io)?;
        Ok(Self {
            root,
            lock: Mutex::new(()),
        })
    }

    fn path_for(&self, id: &str) -> Result<PathBuf, StoreError> {
        validate_id(id)?;
        Ok(self.root.join(format!("{id}.json")))
    }

    pub fn list(&self) -> Result<Vec<DocumentMeta>, StoreError> {
        let _g = self.lock.lock().ok();
        let mut out = Vec::new();
        let entries = fs::read_dir(&self.root).map_err(StoreError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match read_doc(&path) {
                Ok(doc) => out.push(DocumentMeta {
                    id: doc.id,
                    title: doc.title,
                    starred: doc.starred,
                    created_at: doc.created_at,
                    updated_at: doc.updated_at,
                }),
                Err(e) => tracing::warn!(path = %path.display(), error = %e, "skip bad document"),
            }
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Document, StoreError> {
        let _g = self.lock.lock().ok();
        let path = self.path_for(id)?;
        if !path.exists() {
            return Err(StoreError::NotFound);
        }
        read_doc(&path)
    }

    pub fn create(&self, body: SaveDocument) -> Result<Document, StoreError> {
        let _g = self.lock.lock().ok();
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let doc = Document {
            id: id.clone(),
            title: sanitize_title(body.title.unwrap_or_else(|| "Untitled document".into())),
            html: body.html.unwrap_or_default(),
            starred: body.starred.unwrap_or(false),
            created_at: now,
            updated_at: now,
        };
        write_doc(&self.path_for(&id)?, &doc)?;
        Ok(doc)
    }

    pub fn update(&self, id: &str, body: SaveDocument) -> Result<Document, StoreError> {
        let _g = self.lock.lock().ok();
        let path = self.path_for(id)?;
        if !path.exists() {
            return Err(StoreError::NotFound);
        }
        let mut doc = read_doc(&path)?;
        if let Some(title) = body.title {
            doc.title = sanitize_title(title);
        }
        if let Some(html) = body.html {
            // Cap size to avoid pathological local files (~8 MiB).
            if html.len() > 8 * 1024 * 1024 {
                return Err(StoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "document too large",
                )));
            }
            doc.html = html;
        }
        if let Some(starred) = body.starred {
            doc.starred = starred;
        }
        doc.updated_at = Utc::now();
        write_doc(&path, &doc)?;
        Ok(doc)
    }

    pub fn delete(&self, id: &str) -> Result<(), StoreError> {
        let _g = self.lock.lock().ok();
        let path = self.path_for(id)?;
        if !path.exists() {
            return Err(StoreError::NotFound);
        }
        fs::remove_file(path).map_err(StoreError::Io)
    }
}

fn validate_id(id: &str) -> Result<(), StoreError> {
    if id.is_empty() || id.len() > 64 {
        return Err(StoreError::InvalidId);
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(StoreError::InvalidId);
    }
    Ok(())
}

fn sanitize_title(title: String) -> String {
    let t = title.trim();
    if t.is_empty() {
        "Untitled document".into()
    } else {
        t.chars().take(200).collect()
    }
}

fn read_doc(path: &Path) -> Result<Document, StoreError> {
    let raw = fs::read_to_string(path).map_err(StoreError::Io)?;
    serde_json::from_str(&raw).map_err(StoreError::Json)
}

fn write_doc(path: &Path, doc: &Document) -> Result<(), StoreError> {
    let raw = serde_json::to_string_pretty(doc).map_err(StoreError::Json)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, raw.as_bytes()).map_err(StoreError::Io)?;
    fs::rename(&tmp, path).map_err(StoreError::Io)
}

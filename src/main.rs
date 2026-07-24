//! Cognition WP — local-first document backend.
//! Serves the static UI and opens files from the user's Documents folder.

mod documents;
mod export;
mod files;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Multipart, Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum::body::Body;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use documents::{Document, DocumentMeta, DocumentStore, SaveDocument};
use files::{
    list_documents_folder, open_bytes, open_file, read_raw_file, resolve_documents_dir, OpenPathBody,
};

#[derive(Clone)]
struct AppState {
    store: Arc<DocumentStore>,
    docs_dir: PathBuf,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let data_dir = resolve_data_dir();
    std::fs::create_dir_all(&data_dir)?;
    tracing::info!(path = %data_dir.display(), "app data store");

    let docs_dir = resolve_documents_dir();
    std::fs::create_dir_all(&docs_dir)?;
    tracing::info!(path = %docs_dir.display(), "user Documents folder");

    let store = Arc::new(DocumentStore::open(data_dir)?);
    let state = AppState { store, docs_dir };

    let static_dir = resolve_static_dir();
    tracing::info!(path = %static_dir.display(), "static assets");

    let index = static_dir.join("index.html");
    let spa = ServeDir::new(&static_dir).not_found_service(ServeFile::new(index));

    let api = Router::new()
        .route("/health", get(health))
        .route("/documents", get(list_documents).post(create_document))
        .route(
            "/documents/{id}",
            get(get_document).put(update_document).delete(delete_document),
        )
        .route("/files", get(list_files))
        .route("/files/open", post(open_path))
        .route("/files/import", post(import_upload))
        .route("/files/raw", get(serve_raw_file))
        .route("/files/docs-dir", get(docs_dir_info))
        .route("/export", post(export_document));

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(spa)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Cognition WP listening on http://{addr}");
    tracing::info!("Local-only mode — no cloud endpoints");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("COGNITION_DATA_DIR") {
        return PathBuf::from(p);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("documents")
}

fn resolve_static_dir() -> PathBuf {
    if let Ok(p) = std::env::var("COGNITION_STATIC_DIR") {
        return PathBuf::from(p);
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidates = [
        cwd.join("static"),
        cwd.join("frontend"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("static"),
    ];
    for c in candidates {
        if c.join("index.html").exists() {
            return c;
        }
    }
    cwd.join("static")
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "app": "Cognition WP",
        "mode": "local",
        "cloud": false,
        "documents_dir": state.docs_dir.display().to_string(),
    }))
}

async fn docs_dir_info(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "path": state.docs_dir.display().to_string(),
    }))
}

async fn list_files(State(state): State<AppState>) -> Result<Json<Vec<files::FileEntry>>, ApiError> {
    let list = list_documents_folder(&state.docs_dir).map_err(ApiError::from)?;
    Ok(Json(list))
}

async fn open_path(
    State(state): State<AppState>,
    Json(body): Json<OpenPathBody>,
) -> Result<Json<files::OpenedFile>, ApiError> {
    let opened = open_file(&state.docs_dir, &body.path).map_err(ApiError::from)?;
    Ok(Json(opened))
}

async fn serve_raw_file(
    State(state): State<AppState>,
    Query(q): Query<OpenPathBody>,
) -> Result<Response, ApiError> {
    let (bytes, mime) = read_raw_file(&state.docs_dir, &q.path).map_err(ApiError::from)?;
    let mut res = Response::new(Body::from(bytes));
    *res.status_mut() = StatusCode::OK;
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    res.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("inline"),
    );
    res.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=60"),
    );
    Ok(res)
}

async fn import_upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<files::OpenedFile>, ApiError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad(e.to_string()))?
    {
        let name = field.file_name().unwrap_or("upload").to_string();
        let ext = std::path::Path::new(&name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let data = field
            .bytes()
            .await
            .map_err(|e| ApiError::bad(e.to_string()))?;
        let title = std::path::Path::new(&name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled document".into());

        // PDFs: write into Documents so the client can stream via /api/files/raw
        // (avoids multi-megabyte base64 JSON payloads that break large imports).
        if ext == "pdf" {
            let safe_name = sanitize_import_name(&name);
            let dest = state.docs_dir.join(&safe_name);
            std::fs::write(&dest, &data).map_err(|e| ApiError::bad(e.to_string()))?;
            let rel = safe_name.replace('\\', "/");
            let opened = open_file(&state.docs_dir, &rel).map_err(ApiError::from)?;
            return Ok(Json(opened));
        }

        let opened = open_bytes(&name, &name, &ext, &title, &data).map_err(ApiError::from)?;
        return Ok(Json(opened));
    }
    Err(ApiError::bad("no file in upload".into()))
}

/// Keep only the file name; replace path separators and control chars.
fn sanitize_import_name(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload.pdf".into());
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    if cleaned.trim().is_empty() {
        "upload.pdf".into()
    } else {
        cleaned
    }
}

async fn export_document(
    Json(body): Json<export::ExportBody>,
) -> Result<Response, ApiError> {
    let file = export::export_document(&body).map_err(ApiError::from)?;
    let mut res = Response::new(Body::from(file.bytes));
    *res.status_mut() = StatusCode::OK;
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        file.content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    let disp = format!("attachment; filename=\"{}\"", file.filename.replace('"', ""));
    res.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        disp.parse()
            .unwrap_or_else(|_| "attachment".parse().unwrap()),
    );
    Ok(res)
}

async fn list_documents(State(state): State<AppState>) -> Result<Json<Vec<DocumentMeta>>, ApiError> {
    let list = state.store.list().map_err(ApiError::from)?;
    Ok(Json(list))
}

async fn create_document(
    State(state): State<AppState>,
    Json(body): Json<SaveDocument>,
) -> Result<(StatusCode, Json<Document>), ApiError> {
    let doc = state.store.create(body).map_err(ApiError::from)?;
    Ok((StatusCode::CREATED, Json(doc)))
}

async fn get_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Document>, ApiError> {
    let doc = state.store.get(&id).map_err(ApiError::from)?;
    Ok(Json(doc))
}

async fn update_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<SaveDocument>,
) -> Result<Json<Document>, ApiError> {
    let doc = state.store.update(&id, body).map_err(ApiError::from)?;
    Ok(Json(doc))
}

async fn delete_document(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.store.delete(&id).map_err(ApiError::from)?;
    Ok(StatusCode::NO_CONTENT)
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad(msg: String) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: msg,
        }
    }
}

impl From<documents::StoreError> for ApiError {
    fn from(err: documents::StoreError) -> Self {
        match err {
            documents::StoreError::NotFound => Self {
                status: StatusCode::NOT_FOUND,
                message: "Document not found".into(),
            },
            documents::StoreError::InvalidId => Self {
                status: StatusCode::BAD_REQUEST,
                message: "Invalid document id".into(),
            },
            documents::StoreError::Io(e) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: e.to_string(),
            },
            documents::StoreError::Json(e) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: e.to_string(),
            },
        }
    }
}

impl From<export::ExportError> for ApiError {
    fn from(err: export::ExportError) -> Self {
        match err {
            export::ExportError::Unsupported => Self {
                status: StatusCode::BAD_REQUEST,
                message: "Unsupported export format".into(),
            },
            export::ExportError::Other(s) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: s,
            },
        }
    }
}

impl From<files::FileError> for ApiError {
    fn from(err: files::FileError) -> Self {
        match err {
            files::FileError::NotFound => Self {
                status: StatusCode::NOT_FOUND,
                message: "File not found".into(),
            },
            files::FileError::InvalidPath => Self {
                status: StatusCode::BAD_REQUEST,
                message: "Invalid path".into(),
            },
            files::FileError::Unsupported => Self {
                status: StatusCode::UNSUPPORTED_MEDIA_TYPE,
                message: "Unsupported file type".into(),
            },
            files::FileError::Io(e) => Self {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: e.to_string(),
            },
            files::FileError::Other(s) => Self {
                status: StatusCode::BAD_REQUEST,
                message: s,
            },
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}

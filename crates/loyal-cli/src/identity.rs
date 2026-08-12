use anyhow::{anyhow, bail, Context, Result};
use log::debug;
use solana_sdk::{
    signature::{EncodableKey, Keypair},
    signer::Signer,
};
use std::{
    fs,
    fs::File,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReadyIdentity {
    pub(crate) keypair_path: String,
    pub(crate) pubkey: String,
}

pub(crate) struct LoadedIdentity {
    pub(crate) keypair_path: String,
    pub(crate) keypair: Keypair,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IdentityState {
    Ready(ReadyIdentity),
    Missing { keypair_path: String },
    Unreadable { keypair_path: String, error: String },
}

enum ReadIdentityFailure {
    Missing,
    Unreadable(String),
}

pub(crate) fn init_identity(keypair_path: &Path, force: bool) -> Result<ReadyIdentity> {
    debug!("initializing Loyal identity at {}", keypair_path.display());
    init_identity_at_path(keypair_path, force)
}

pub(crate) fn ensure_identity(keypair_path: &Path, force: bool) -> Result<ReadyIdentity> {
    if force {
        return init_identity(keypair_path, true);
    }

    match inspect_identity(keypair_path) {
        IdentityState::Ready(identity) => Ok(identity),
        IdentityState::Missing { .. } => init_identity(keypair_path, false),
        IdentityState::Unreadable {
            keypair_path,
            error,
        } => bail!(unreadable_identity_message(&keypair_path, &error)),
    }
}

pub(crate) fn inspect_identity(keypair_path: &Path) -> IdentityState {
    debug!("inspecting Loyal identity at {}", keypair_path.display());
    inspect_identity_at_path(keypair_path)
}

pub(crate) fn load_identity(keypair_path: &Path) -> Result<LoadedIdentity> {
    debug!("loading Loyal identity from {}", keypair_path.display());
    load_identity_at_path(keypair_path)
}

fn init_identity_at_path(keypair_path: &Path, force: bool) -> Result<ReadyIdentity> {
    let display_path = display_path(keypair_path);
    let parent_dir = parent_dir_for(keypair_path);
    fs::create_dir_all(&parent_dir).with_context(|| {
        format!(
            "failed to create parent directory for keypair at {}",
            display_path
        )
    })?;

    let keypair = Keypair::new();
    persist_keypair_atomically(&keypair, keypair_path, &parent_dir, force)?;
    set_owner_only_permissions(keypair_path)?;

    Ok(ReadyIdentity {
        keypair_path: display_path,
        pubkey: keypair.pubkey().to_string(),
    })
}

fn inspect_identity_at_path(keypair_path: &Path) -> IdentityState {
    let display_path = display_path(keypair_path);
    match read_keypair(keypair_path) {
        Ok(keypair) => IdentityState::Ready(ReadyIdentity {
            keypair_path: display_path,
            pubkey: keypair.pubkey().to_string(),
        }),
        Err(ReadIdentityFailure::Missing) => IdentityState::Missing {
            keypair_path: display_path,
        },
        Err(ReadIdentityFailure::Unreadable(error)) => IdentityState::Unreadable {
            keypair_path: display_path,
            error,
        },
    }
}

fn load_identity_at_path(keypair_path: &Path) -> Result<LoadedIdentity> {
    let display_path = display_path(keypair_path);
    match read_keypair(keypair_path) {
        Ok(keypair) => Ok(LoadedIdentity {
            keypair_path: display_path,
            keypair,
        }),
        Err(ReadIdentityFailure::Missing) => bail!(missing_identity_message(&display_path)),
        Err(ReadIdentityFailure::Unreadable(error)) => {
            bail!(unreadable_identity_message(&display_path, &error))
        }
    }
}

fn read_keypair(keypair_path: &Path) -> std::result::Result<Keypair, ReadIdentityFailure> {
    let mut file = File::open(keypair_path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => ReadIdentityFailure::Missing,
        _ => ReadIdentityFailure::Unreadable(format!("failed to open keypair file: {error}")),
    })?;

    Keypair::read(&mut file).map_err(|error| {
        ReadIdentityFailure::Unreadable(format!("failed to read keypair file: {error}"))
    })
}

fn persist_keypair_atomically(
    keypair: &Keypair,
    keypair_path: &Path,
    parent_dir: &Path,
    force: bool,
) -> Result<()> {
    let mut temp_file = NamedTempFile::new_in(parent_dir).with_context(|| {
        format!(
            "failed to create temporary keypair file in {}",
            parent_dir.display()
        )
    })?;

    keypair.write(temp_file.as_file_mut()).map_err(|error| {
        anyhow!(
            "failed to encode keypair {}: {error}",
            keypair_path.display()
        )
    })?;

    temp_file
        .as_file_mut()
        .flush()
        .with_context(|| format!("failed to flush keypair {}", keypair_path.display()))?;
    temp_file
        .as_file_mut()
        .sync_all()
        .with_context(|| format!("failed to sync keypair {}", keypair_path.display()))?;

    if force {
        temp_file.persist(keypair_path).map_err(|error| {
            anyhow!(
                "failed to persist keypair {}: {}",
                keypair_path.display(),
                error.error
            )
        })?;
        sync_parent_dir(parent_dir)?;
        return Ok(());
    }

    temp_file.persist_noclobber(keypair_path).map_err(|error| {
        if error.error.kind() == io::ErrorKind::AlreadyExists {
            anyhow!(overwrite_refusal_message(&display_path(keypair_path)))
        } else {
            anyhow!(
                "failed to persist keypair {}: {}",
                keypair_path.display(),
                error.error
            )
        }
    })?;
    sync_parent_dir(parent_dir)?;

    Ok(())
}

fn parent_dir_for(keypair_path: &Path) -> PathBuf {
    keypair_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

fn missing_identity_message(keypair_path: &str) -> String {
    format!("No Loyal agent identity found at {keypair_path}.\nRun `loyal auth` to create one.")
}

fn unreadable_identity_message(keypair_path: &str, error: &str) -> String {
    format!("Unable to read Loyal agent identity at {keypair_path}.\n{error}")
}

fn overwrite_refusal_message(keypair_path: &str) -> String {
    format!(
        "Refusing to overwrite existing keypair at {keypair_path}.\nRun `loyal auth --force` if you want to replace it."
    )
}

fn set_owner_only_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path)
            .with_context(|| format!("failed to read permissions for {}", path.display()))?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(path, permissions)
            .with_context(|| format!("failed to set permissions for {}", path.display()))?;
    }

    Ok(())
}

fn sync_parent_dir(parent_dir: &Path) -> Result<()> {
    let directory = File::open(parent_dir)
        .with_context(|| format!("failed to open parent directory {}", parent_dir.display()))?;
    directory
        .sync_all()
        .with_context(|| format!("failed to sync parent directory {}", parent_dir.display()))?;
    Ok(())
}

use anyhow::{anyhow, bail, Context, Result};
use log::debug;
use solana_sdk::{
    signature::{EncodableKey, Keypair},
    signer::Signer,
};
use std::{
    env, fs,
    fs::File,
    io::{self, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

const KEYPAIR_ENV_VAR: &str = "LOYAL_SMART_ACCOUNTS_KEYPAIR";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReadyIdentity {
    pub(crate) keypair_path: String,
    pub(crate) pubkey: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IdentityState {
    Ready(ReadyIdentity),
    Missing { keypair_path: String },
    Unreadable { keypair_path: String, error: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SignedMessage {
    pub(crate) keypair_path: String,
    pub(crate) pubkey: String,
    pub(crate) message: String,
    pub(crate) signature: String,
}

struct LoadedIdentity {
    keypair_path: String,
    keypair: Keypair,
}

enum ReadIdentityFailure {
    Missing,
    Unreadable(String),
}

pub(crate) fn init_identity(cli_keypair: Option<&str>, force: bool) -> Result<ReadyIdentity> {
    let keypair_path = resolve_keypair_path(cli_keypair)?;
    debug!("initializing identity at {}", keypair_path.display());
    init_identity_at_path(&keypair_path, force)
}

pub(crate) fn inspect_identity(cli_keypair: Option<&str>) -> Result<IdentityState> {
    let keypair_path = resolve_keypair_path(cli_keypair)?;
    debug!("inspecting identity at {}", keypair_path.display());
    Ok(inspect_identity_at_path(&keypair_path))
}

pub(crate) fn read_identity(cli_keypair: Option<&str>) -> Result<ReadyIdentity> {
    let keypair_path = resolve_keypair_path(cli_keypair)?;
    debug!("reading identity from {}", keypair_path.display());
    load_identity_at_path(&keypair_path).map(|identity| ReadyIdentity {
        keypair_path: identity.keypair_path,
        pubkey: identity.keypair.pubkey().to_string(),
    })
}

pub(crate) fn sign_message(cli_keypair: Option<&str>, message: &str) -> Result<SignedMessage> {
    let keypair_path = resolve_keypair_path(cli_keypair)?;
    debug!(
        "signing message with identity at {}",
        keypair_path.display()
    );
    sign_message_at_path(&keypair_path, message)
}

pub(crate) fn resolve_keypair_path(cli_keypair: Option<&str>) -> Result<PathBuf> {
    let env_keypair = env::var(KEYPAIR_ENV_VAR).ok();
    resolve_keypair_path_with(
        cli_keypair,
        env_keypair.as_deref(),
        dirs::config_dir(),
        dirs::home_dir(),
    )
}

fn resolve_keypair_path_with(
    cli_keypair: Option<&str>,
    env_keypair: Option<&str>,
    config_dir: Option<PathBuf>,
    home_dir: Option<PathBuf>,
) -> Result<PathBuf> {
    if let Some(raw_path) = cli_keypair.or(env_keypair) {
        return Ok(expand_tilde_with_home(raw_path, home_dir.as_deref()));
    }

    let config_dir = config_dir.ok_or_else(|| {
        anyhow!(
            "Unable to determine the platform config directory.\nPass `--keypair <path>` or set {KEYPAIR_ENV_VAR}."
        )
    })?;

    Ok(config_dir.join("loyal").join("smart-accounts.json"))
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

fn sign_message_at_path(keypair_path: &Path, message: &str) -> Result<SignedMessage> {
    let identity = load_identity_at_path(keypair_path)?;
    let signature = identity
        .keypair
        .sign_message(message.as_bytes())
        .to_string();

    Ok(SignedMessage {
        keypair_path: identity.keypair_path,
        pubkey: identity.keypair.pubkey().to_string(),
        message: message.to_string(),
        signature,
    })
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

fn expand_tilde_with_home(path: &str, home_dir: Option<&Path>) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

pub(crate) fn identity_guidance() -> &'static str {
    "Add this pubkey in the Loyal web app as a smart-account signer with propose-only `Initiate` permission."
}

fn missing_identity_message(keypair_path: &str) -> String {
    format!(
        "No dedicated Loyal signer identity found at {keypair_path}.\nRun `loyal-smart-accounts init` to create one."
    )
}

fn unreadable_identity_message(keypair_path: &str, error: &str) -> String {
    format!("Unable to read dedicated Loyal signer identity at {keypair_path}.\n{error}")
}

fn overwrite_refusal_message(keypair_path: &str) -> String {
    format!(
        "Refusing to overwrite existing keypair at {keypair_path}.\nRun `loyal-smart-accounts init --force` if you want to replace it."
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolves_keypair_path_precedence() {
        let config_dir = tempdir().unwrap();
        let home_dir = tempdir().unwrap();

        let flag_resolved = resolve_keypair_path_with(
            Some("~/from-flag.json"),
            Some("~/from-env.json"),
            Some(config_dir.path().to_path_buf()),
            Some(home_dir.path().to_path_buf()),
        )
        .unwrap();
        assert_eq!(flag_resolved, home_dir.path().join("from-flag.json"));

        let env_resolved = resolve_keypair_path_with(
            None,
            Some("~/from-env.json"),
            Some(config_dir.path().to_path_buf()),
            Some(home_dir.path().to_path_buf()),
        )
        .unwrap();
        assert_eq!(env_resolved, home_dir.path().join("from-env.json"));

        let default_resolved = resolve_keypair_path_with(
            None,
            None,
            Some(config_dir.path().to_path_buf()),
            Some(home_dir.path().to_path_buf()),
        )
        .unwrap();
        assert_eq!(
            default_resolved,
            config_dir.path().join("loyal").join("smart-accounts.json")
        );
    }

    #[test]
    fn resolve_keypair_path_requires_config_dir_without_overrides() {
        let error = resolve_keypair_path_with(None, None, None, None).unwrap_err();
        assert!(error
            .to_string()
            .contains("Unable to determine the platform config directory"));
    }

    #[test]
    fn init_creates_parent_dir_and_keypair_file() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("nested/loyal/smart-accounts.json");

        let identity = init_identity_at_path(&keypair_path, false).unwrap();

        assert!(keypair_path.exists());
        assert_eq!(identity.keypair_path, display_path(&keypair_path));
        assert!(!identity.pubkey.is_empty());
    }

    #[test]
    fn init_refuses_overwrite_without_force() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");
        let original_keypair = fixture_keypair();
        original_keypair.write_to_file(&keypair_path).unwrap();

        let error = init_identity_at_path(&keypair_path, false).unwrap_err();

        assert!(error
            .to_string()
            .contains("Refusing to overwrite existing keypair"));

        let reloaded = Keypair::read_from_file(&keypair_path).unwrap();
        assert_eq!(
            reloaded.pubkey().to_string(),
            original_keypair.pubkey().to_string()
        );
    }

    #[test]
    fn init_force_replaces_existing_keypair() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");
        let original_keypair = fixture_keypair();
        let original_pubkey = original_keypair.pubkey().to_string();
        original_keypair.write_to_file(&keypair_path).unwrap();

        let replaced = init_identity_at_path(&keypair_path, true).unwrap();

        assert_ne!(replaced.pubkey, original_pubkey);
    }

    #[test]
    fn read_identity_returns_expected_pubkey() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");
        let keypair = fixture_keypair();
        let expected_pubkey = keypair.pubkey().to_string();
        keypair.write_to_file(&keypair_path).unwrap();

        let identity = load_identity_at_path(&keypair_path).unwrap();

        assert_eq!(identity.keypair_path, display_path(&keypair_path));
        assert_eq!(identity.keypair.pubkey().to_string(), expected_pubkey);
    }

    #[test]
    fn inspect_identity_reports_missing_present_and_unreadable() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");

        let missing = inspect_identity_at_path(&keypair_path);
        assert_eq!(
            missing,
            IdentityState::Missing {
                keypair_path: display_path(&keypair_path),
            }
        );

        let keypair = fixture_keypair();
        let expected_pubkey = keypair.pubkey().to_string();
        keypair.write_to_file(&keypair_path).unwrap();

        let present = inspect_identity_at_path(&keypair_path);
        assert_eq!(
            present,
            IdentityState::Ready(ReadyIdentity {
                keypair_path: display_path(&keypair_path),
                pubkey: expected_pubkey,
            })
        );

        fs::write(&keypair_path, b"not-json").unwrap();
        let unreadable = inspect_identity_at_path(&keypair_path);
        match unreadable {
            IdentityState::Unreadable {
                keypair_path: unreadable_path,
                error,
            } => {
                assert_eq!(unreadable_path, display_path(&keypair_path));
                assert!(error.contains("failed to read keypair file"));
            }
            other => panic!("expected unreadable state, got {other:?}"),
        }
    }

    #[test]
    fn sign_message_returns_expected_signature() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");
        let message = "hello loyal";
        let keypair = fixture_keypair();
        let expected_signature = keypair.sign_message(message.as_bytes()).to_string();
        let expected_pubkey = keypair.pubkey().to_string();
        keypair.write_to_file(&keypair_path).unwrap();

        let signed = sign_message_at_path(&keypair_path, message).unwrap();

        assert_eq!(
            signed,
            SignedMessage {
                keypair_path: display_path(&keypair_path),
                pubkey: expected_pubkey,
                message: message.to_string(),
                signature: expected_signature,
            }
        );
    }

    #[test]
    fn load_identity_returns_helpful_error_for_unreadable_keypair() {
        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");
        fs::write(&keypair_path, b"not-json").unwrap();

        let error = load_identity_at_path(&keypair_path).err().unwrap();

        assert!(error
            .to_string()
            .contains("Unable to read dedicated Loyal signer identity"));
    }

    #[cfg(unix)]
    #[test]
    fn init_sets_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().unwrap();
        let keypair_path = temp.path().join("smart-accounts.json");

        init_identity_at_path(&keypair_path, false).unwrap();

        let mode = fs::metadata(&keypair_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    fn fixture_keypair() -> Keypair {
        Keypair::new_from_array([7u8; 32])
    }
}

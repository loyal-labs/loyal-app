pub use crate::generated::types::{CreateSmartAccountArgs, Permissions, SmartAccountSigner};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    Initiate = 0b0000_0001,
    Vote = 0b0000_0010,
    Execute = 0b0000_0100,
}

impl Permissions {
    pub fn from_permissions(permissions: &[Permission]) -> Self {
        Self {
            mask: permissions
                .iter()
                .fold(0u8, |mask, permission| mask | (*permission as u8)),
        }
    }

    pub fn all() -> Self {
        Self::from_permissions(&[Permission::Initiate, Permission::Vote, Permission::Execute])
    }

    pub fn has(&self, permission: Permission) -> bool {
        self.mask & (permission as u8) == (permission as u8)
    }
}

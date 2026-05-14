Pod::Spec.new do |s|
  s.name           = 'ExpoSeedVault'
  s.version        = '0.1.0'
  s.summary        = 'Expo bindings for the Solana Mobile Seed Vault SDK (iOS stub)'
  s.description    = 'Stub implementation. Seed Vault is Android-only; every entry point on iOS reports unavailability.'
  s.author         = ''
  s.homepage       = 'https://github.com/solana-mobile/seed-vault-sdk'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end

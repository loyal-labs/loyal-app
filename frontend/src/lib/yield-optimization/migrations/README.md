# Yield Neon migration ownership

These SQL files are historical compatibility snapshots for app-side schema
review. They are not a provisioning or deployment migration chain, and this
repository intentionally has no runner that applies them.

`loyal-yield-routing` is the sole migration authority for the `loyal_yield`
schema. Apply and verify its ordered `yield-migrations` binary before running
the realtime service or autodeposit worker. In particular, the web/mobile
protocol and requested-slot wakeup migrations must come from routing; do not
bootstrap realtime from the older app snapshots in this directory.

# robot-controller

FTC RC-app Android build. Vendored from the FIRST Tech Challenge SDK,
trimmed to what this project actually uses.

## Layout

- `FtcRobotController/` — the RC app itself. Vendored from the SDK, sample
  OpModes stripped. Ships the activity + resources; you almost never edit
  in here.
- `Server/` — Android-library shim. Source-includes `../../Server` (Kotlin
  JVM module at repo root) so the on-robot build compiles the same WS +
  program-cursor code as the standalone `./gradlew :Server:run` runner.
- `TeamCode/` — where team OpModes go. Currently just `ServerOpMode.java`,
  which owns the PD control loop and calls into `:Server`.

## Building

```
./gradlew :TeamCode:assembleDebug
```

Install the resulting APK on the RC phone via `adb install`.

## Signing

`libs/ftc.debug.keystore` is the standard FTC debug keystore. Do not
regenerate; both the Driver Station and Robot Controller must be signed
with the same key.

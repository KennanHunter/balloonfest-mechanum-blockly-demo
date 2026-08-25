# demo

Blockly-programmed mecanum robot that runs identically against a
Cloudflare-hosted simulator and a real FTC chassis. The browser client
speaks one wire protocol; on the other end is either the worker sim or
the on-robot Server module.

## Repo layout

```
worker/            Cloudflare Worker — physics sim + PD, WebSocket at /ws
web/               Solid.js UI — Blockly editor + field overlay
Server/            Kotlin JVM app — WS server + program cursor. Standalone dev
                   runner (`just server`); same sources compile into the FTC
                   Android build via source-include.
robot-controller/  FTC RC-app Android build (vendored SDK, slimmed).
                   Consumes /Server as an android-library shim.
```

The sim and the robot share three things and disagree on nothing else:
- **Wire protocol** — worker/src/protocol.ts and Server's WsServer.kt
  encode/decode the same JSON messages.
- **PD math + mecanum inverse** — worker/src/{controller,kinematics}.ts
  and Server/src/main/java/com/example/teamcode/{PDController,Chassis}.java
  are line-for-line ports.
- **Path sampling** — worker/src/program.ts and Server's ProgramCompiler.kt
  produce byte-identical paths from the same program.

## Wire protocol

Client → server:
- `{type: 'play', program: {commands: [...]}, gains?: {...}}`
- `{type: 'stop'}`
- `{type: 'reset'}`
- `{type: 'set_gains', gains: {...}}`

Server → client (broadcast at ~30 Hz):
- `{type: 'robot_position', x, y, theta}`
- `{type: 'target_position', x, y, theta}`
- `{type: 'motor_power', motors: {fl: {voltage}, fr, bl, br}}`
- `{type: 'active_block', id | null}`
- `{type: 'active_path', blockId, path: [{x,y,theta}...]}`

## Local dev

```
just install               # pnpm workspace deps
just dev                   # web (:3000) + worker (:8787) in parallel
just server                # standalone Kotlin Server on :8081 with event logs
```

`just server` gives you the same wire protocol as the worker but with a
tiny toy plant instead of the mecanum sim. It exists to eyeball each
protocol event without booting an FTC RC app.

## Deploying to a real robot

The bit that changes is which "server" the client talks to — the worker
at `wss://your.worker.dev/ws` or the RC phone at `ws://<phone-ip>:8081`.
Everything else about the UI is identical.

### 1. Configure the RC hardware map

Names the OpMode expects (`robot-controller/TeamCode/src/main/java/.../ServerOpMode.java`):
- `DcMotor`: `front_left`, `front_right`, `rear_left`, `rear_right`
- `SparkFunOTOS`: `otos`

Either rename in the RC app's config, or edit the strings in
`ServerOpMode.java`.

### 2. Set real chassis geometry

`Server/src/main/java/com/example/teamcode/Chassis.java`:

```java
public static final double HALF_LEN = 0.2;   // ← set to your fore/aft
public static final double HALF_WID = 0.2;   // ← set to your lateral
```

Measure center-to-wheel-contact, not frame-to-frame. Wrong values here
cross-couple rotation into translation.

### 3. Calibrate the OTOS

`ServerOpMode.java` currently does the bare minimum:

```java
otos.setLinearUnit(DistanceUnit.METER);
otos.setAngularUnit(AngleUnit.RADIANS);
otos.calibrateImu();
otos.resetTracking();
```

Add these based on your physical setup (see the SparkFun docs / example
sketch for the calibration procedure):

```java
otos.setOffset(new Pose2D(offsetX, offsetY, offsetH));  // OTOS-to-robot-center
otos.setLinearScalar(1.0);                              // measured, ~0.98–1.02
otos.setAngularScalar(1.0);                             // measured, ~0.98–1.02
```

Skipping calibration = pose reads that drift systematically = PD chases
phantom errors.

### 4. Bench-test motor directions

The OpMode reverses `front_right` and `rear_right`:

```java
frontRight.setDirection(DcMotorSimple.Direction.REVERSE);
rearRight.setDirection(DcMotorSimple.Direction.REVERSE);
```

Before running a program, put the bot on blocks and manually poke each
motor to confirm positive power spins each wheel forward-top. Swap the
`setDirection` lines as needed. Getting this wrong = spin in place.

### 5. Build and install the APK

```
cd robot-controller
./gradlew :TeamCode:assembleDebug
adb install -r TeamCode/build/outputs/apk/debug/TeamCode-debug.apk
```

The Server module ships inside that APK — `robot-controller/Server/build.gradle`
source-includes `../../Server/src/{main/java,main/kotlin}`, so both
targets are always in lockstep.

### 6. Connect from the browser

On the RC phone, find its IP (usually `192.168.43.1` in AP mode).
Point the web UI's WebSocket URL at `ws://<phone-ip>:8081`. Hit Play.

The OpMode logs the session-start pose to telemetry, and the browser's
motor readout should start ticking as PD engages.

## Coordinate conventions

Same across sim and robot:
- `+x = forward, +y = left, +θ = CCW yaw`
- Wheel order everywhere: `[FL, FR, BL, BR]`
- Distances in meters, angles in radians

Programs are compiled from *current pose*, not any field origin. "Forward"
means one tile (60 cm) ahead of wherever the robot is right now.
`return_to_start` returns to the pose captured when the OpMode was
started (right after `waitForStart`).

## Known gaps

- `ServerOpMode.readVelocity()` reads the OTOS twice per tick. Cheap
  fix; measure loop time on the bot before deciding if it matters.
- Confirm whether your OTOS SDK version's `getVelocity()` returns
  world-frame or body-frame. The OpMode assumes world-frame and rotates.
- No connection-loss handling. If the browser drops mid-program the
  robot keeps executing (probably what you want on the field; verify).

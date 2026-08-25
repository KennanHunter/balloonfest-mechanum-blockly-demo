package org.firstinspires.ftc.teamserver

import com.example.teamcode.BodyVel
import com.example.teamcode.Gains
import com.example.teamcode.PDController
import com.example.teamcode.Pose
import com.example.teamcode.Tolerances

/**
 * Program cursor + wire bridge. The OpMode owns the control loop and does
 * the PD math; this module owns the *program semantics* — which target
 * pose is current, when to advance to the next sample, when the current
 * block is done — and shuttles telemetry to WebSocket clients.
 *
 * OpMode lifecycle:
 * ```
 * Server.registerOpMode()               // starts the WS server
 * while (opModeIsActive()) {
 *     Pose pose = otos.getPose();
 *     BodyVel vel = /* estimate */;
 *     ControlSnapshot snap = Server.snapshot();
 *     double[] volts;
 *     if (snap.getTarget() != null) {
 *         BodyVel cmd = pd.step(snap.getTarget(), pose, vel, snap.getGains());
 *         volts = Chassis.wheelVolts(cmd.vx(), cmd.vy(), cmd.omega());
 *         applyMotors(volts);
 *     } else {
 *         volts = new double[]{0,0,0,0};
 *         applyMotors(volts);
 *     }
 *     Server.reportTick(pose, vel, volts);
 * }
 * Server.unregisterOpMode();
 * ```
 */
object Server {
    private const val WS_PORT = 8081
    private const val SAMPLES_PER_TICK = 1

    private val pd = PDController()
    private val tolerances = Tolerances.defaults()

    @Volatile private var wsServer: WsServer? = null

    // ---- cursor state (guarded by [lock]) ----
    private val lock = Any()
    private var blocks: List<ProgramCompiler.Block> = emptyList()
    private var activeBlockIdx: Int = -1
    private var pathIdx: Int = 0
    private var gains: Gains = Gains.defaults()
    /** Set by [registerOpMode]; used as the target for `return_to_start`. */
    private var sessionStart: Pose = ProgramCompiler.canonicalFieldStart()
    /**
     * When a `play` arrives on a WS thread we don't yet have the robot's
     * current pose (only the OpMode has it, via reportTick). Stash the
     * message here and defer compilation to the next reportTick, which
     * hands us a fresh pose.
     */
    private var pendingProgram: ProgramMsg? = null

    // ---------------------------------------------------------------------
    // OpMode-facing lifecycle
    // ---------------------------------------------------------------------

    /**
     * Start the WS server and capture the OpMode's start pose. Call from
     * the OpMode *after* `waitForStart` and one initial pose read, so
     * `return_to_start` has an honest anchor.
     */
    fun registerOpMode(sessionStart: Pose) {
        synchronized(lock) { this.sessionStart = sessionStart }
        if (wsServer != null) return
        val srv = WsServer(WS_PORT, Handlers())
        srv.start(NANOHTTPD_SOCKET_READ_TIMEOUT, true)
        wsServer = srv
        EventLog.event(
            "lifecycle",
            "WS server listening on :$WS_PORT (session start: " +
                "x=${fmt(sessionStart.x())} y=${fmt(sessionStart.y())} θ=${fmt(Math.toDegrees(sessionStart.theta()))}°)",
        )
    }

    fun unregisterOpMode() {
        wsServer?.stop()
        wsServer = null
        synchronized(lock) {
            blocks = emptyList()
            activeBlockIdx = -1
            pathIdx = 0
            pendingProgram = null
        }
        EventLog.event("lifecycle", "WS server stopped")
    }

    private fun fmt(v: Double): String = String.format("%.3f", v)

    // ---------------------------------------------------------------------
    // OpMode-facing control loop API
    // ---------------------------------------------------------------------

    /** Snapshot of what the OpMode should track this tick. Target is null when idle. */
    fun snapshot(): ControlSnapshot = synchronized(lock) {
        val target = currentTargetLocked()
        val blockId =
            if (activeBlockIdx in blocks.indices) blocks[activeBlockIdx].blockId else null
        ControlSnapshot(target, gains, blockId)
    }

    /**
     * Report the tick that just executed. Broadcasts telemetry and advances
     * the program cursor: bumps the path sample, and if we're at the end of
     * a block and the PD is converged, moves to the next block.
     */
    fun reportTick(pose: Pose, vel: BodyVel, volts: DoubleArray) {
        require(volts.size == 4) { "volts must be length 4 [FL,FR,BL,BR]" }

        var advancedBlock = false
        var newTargetToBroadcast: Pose? = null
        var justCompiled = false
        val ws = wsServer

        synchronized(lock) {
            // Deferred compile: play messages don't know the current pose;
            // the first reportTick after a play is where we anchor the path.
            pendingProgram?.let { program ->
                blocks = ProgramCompiler.compile(pose, sessionStart, program)
                activeBlockIdx = if (blocks.isNotEmpty()) 0 else -1
                pathIdx = 0
                pendingProgram = null
                justCompiled = true
                newTargetToBroadcast = blocks.firstOrNull()?.path?.firstOrNull()
                EventLog.event(
                    "program",
                    "compiled from x=${fmt(pose.x())} y=${fmt(pose.y())} θ=${fmt(Math.toDegrees(pose.theta()))}° " +
                        "(${blocks.size} blocks)",
                )
            }

            if (activeBlockIdx in blocks.indices) {
                val block = blocks[activeBlockIdx]
                val lastIdx = block.path.size - 1
                val target = block.path[minOf(pathIdx, lastIdx)]

                if (pathIdx < lastIdx) {
                    pathIdx = minOf(pathIdx + SAMPLES_PER_TICK, lastIdx)
                    newTargetToBroadcast = block.path[pathIdx]
                } else if (pd.reached(target, pose, vel, tolerances)) {
                    val doneBlockId = block.blockId
                    activeBlockIdx++
                    pathIdx = 0
                    advancedBlock = true
                    if (activeBlockIdx >= blocks.size) {
                        activeBlockIdx = -1
                        EventLog.event("program", "finished (last block $doneBlockId)")
                    } else {
                        newTargetToBroadcast = blocks[activeBlockIdx].path.firstOrNull()
                        EventLog.event(
                            "program",
                            "block $doneBlockId reached → advancing to ${blocks[activeBlockIdx].blockId}",
                        )
                    }
                }
            }
        }

        ws ?: return
        ws.broadcastPose(pose)
        ws.broadcastMotors(volts)
        newTargetToBroadcast?.let { ws.broadcastTarget(it) }
        if (advancedBlock || justCompiled) {
            ws.broadcastActive(activeBlockIdOrNull())
            ws.broadcastActivePath(activePathOrEmpty())
        }
    }

    // ---------------------------------------------------------------------
    // Wire handlers (called on WS threads)
    // ---------------------------------------------------------------------

    private class Handlers : WsServer.Handlers {
        override fun onPlay(program: ProgramMsg, newGains: Gains?) {
            EventLog.event(
                "rx",
                "play (${program.commands.size} commands${if (newGains != null) ", + gains" else ""})",
            )
            synchronized(lock) {
                if (newGains != null) gains = newGains
                // Compilation is deferred to the next reportTick so we
                // anchor the path to the robot's *current* pose (which
                // this WS thread doesn't know about). Clear any active
                // program immediately so we don't keep tracking stale
                // targets in the meantime.
                pendingProgram = program
                blocks = emptyList()
                activeBlockIdx = -1
                pathIdx = 0
            }
            wsServer?.let {
                it.broadcastActive(null)
                it.broadcastActivePath(emptyList())
            }
        }

        override fun onStop() {
            EventLog.event("rx", "stop")
            synchronized(lock) {
                pendingProgram = null
                blocks = emptyList()
                activeBlockIdx = -1
                pathIdx = 0
            }
            wsServer?.let {
                it.broadcastActive(null)
                it.broadcastActivePath(emptyList())
            }
        }

        override fun onReset() {
            EventLog.event("rx", "reset")
            // No teleport on real hardware — the OTOS is what it is. Just clear
            // the program so the OpMode holds still.
            onStop()
        }

        override fun onSetGains(newGains: Gains) {
            EventLog.event(
                "rx",
                "set_gains Kp_t=${newGains.kpTrans()} Kd_t=${newGains.kdTrans()} " +
                    "Kp_r=${newGains.kpRot()} Kd_r=${newGains.kdRot()}",
            )
            synchronized(lock) { gains = newGains }
        }

        override fun onClientConnected() {
            EventLog.event("ws", "client connected")
            val snap = snapshot()
            wsServer?.let {
                snap.target?.let { t -> it.broadcastTarget(t) }
                it.broadcastActive(snap.blockId)
                it.broadcastActivePath(activePathOrEmpty())
            }
        }
    }

    // ---------------------------------------------------------------------
    // helpers (must be called under [lock] or with fresh snapshots)
    // ---------------------------------------------------------------------

    private fun currentTargetLocked(): Pose? {
        if (activeBlockIdx !in blocks.indices) return null
        val block = blocks[activeBlockIdx]
        if (block.path.isEmpty()) return null
        return block.path[minOf(pathIdx, block.path.size - 1)]
    }

    private fun currentTarget(): Pose? = synchronized(lock) { currentTargetLocked() }

    private fun activeBlockIdOrNull(): String? = synchronized(lock) {
        if (activeBlockIdx in blocks.indices) blocks[activeBlockIdx].blockId else null
    }

    private fun activePathOrEmpty(): List<Pose> = synchronized(lock) {
        if (activeBlockIdx in blocks.indices) blocks[activeBlockIdx].path else emptyList()
    }

    // NanoHTTPD's constant, inlined so we don't need to import it here.
    private const val NANOHTTPD_SOCKET_READ_TIMEOUT = 10_000
}

/** What the OpMode should be driving toward this tick. */
data class ControlSnapshot(
    val target: Pose?,
    val gains: Gains,
    val blockId: String?,
)

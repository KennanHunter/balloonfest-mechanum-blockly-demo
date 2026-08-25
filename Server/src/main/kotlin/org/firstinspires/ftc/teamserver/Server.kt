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

    private var wsServer: WsServer? = null

    // ---- cursor state (guarded by [lock]) ----
    private val lock = Any()
    private var blocks: List<ProgramCompiler.Block> = emptyList()
    private var activeBlockIdx: Int = -1
    private var pathIdx: Int = 0
    private var gains: Gains = Gains.defaults()

    // ---------------------------------------------------------------------
    // OpMode-facing lifecycle
    // ---------------------------------------------------------------------

    fun registerOpMode() {
        if (wsServer != null) return
        val srv = WsServer(WS_PORT, Handlers())
        srv.start(NANOHTTPD_SOCKET_READ_TIMEOUT, true)
        wsServer = srv
        EventLog.event("lifecycle", "WS server listening on :$WS_PORT")
    }

    fun unregisterOpMode() {
        wsServer?.stop()
        wsServer = null
        synchronized(lock) {
            blocks = emptyList()
            activeBlockIdx = -1
            pathIdx = 0
        }
        EventLog.event("lifecycle", "WS server stopped")
    }

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
        val ws = wsServer

        synchronized(lock) {
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
        if (advancedBlock) {
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
                blocks = ProgramCompiler.compile(ProgramCompiler.startPose(), program)
                activeBlockIdx = if (blocks.isNotEmpty()) 0 else -1
                pathIdx = 0
            }
            wsServer?.let {
                it.broadcastActive(activeBlockIdOrNull())
                it.broadcastActivePath(activePathOrEmpty())
                currentTarget()?.let { t -> it.broadcastTarget(t) }
            }
        }

        override fun onStop() {
            EventLog.event("rx", "stop")
            synchronized(lock) {
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

package org.firstinspires.ftc.teamserver

import com.example.teamcode.BodyVel
import com.example.teamcode.Chassis
import com.example.teamcode.PDController
import com.example.teamcode.Pose

/**
 * Standalone dev runner. Boots the WsServer and runs a headless stub of
 * the OpMode: pretends to have a robot at the canonical start pose,
 * integrates a trivial first-order response to the PD-commanded body vel,
 * and reports each tick back to [Server]. Prints one line per event so
 * you can watch the wire protocol in a terminal.
 *
 * Point the browser at ws://localhost:8081 and hit Play in the UI.
 *
 * Not a physics simulator — the Cloudflare worker is. This is for
 * eyeballing the wire protocol end-to-end without an FTC RC app.
 */
fun main() {
    EventLog.enabled = true
    val loopMs = 33L                                    // ~30 Hz
    val pd = PDController()
    var pose = ProgramCompiler.canonicalFieldStart()
    var vel = BodyVel.zero()

    Server.registerOpMode(pose)
    println("standalone server up. ws://localhost:8081  (Ctrl+C to exit)")

    Runtime.getRuntime().addShutdownHook(Thread { Server.unregisterOpMode() })

    while (true) {
        val snap = Server.snapshot()
        val volts: DoubleArray
        if (snap.target != null) {
            val cmd = pd.step(snap.target, pose, vel, snap.gains)
            volts = Chassis.wheelVolts(cmd.vx(), cmd.vy(), cmd.omega())
            // Toy plant: pretend body velocity relaxes toward the commanded
            // value with a short time constant. Enough to drive convergence
            // so blocks actually advance and you can watch the events fire.
            vel = BodyVel(
                approach(vel.vx(), cmd.vx(), 0.35),
                approach(vel.vy(), cmd.vy(), 0.35),
                approach(vel.omega(), cmd.omega(), 0.35),
            )
            val dt = loopMs / 1000.0
            val c = Math.cos(pose.theta())
            val s = Math.sin(pose.theta())
            pose = Pose(
                pose.x() + (c * vel.vx() - s * vel.vy()) * dt,
                pose.y() + (s * vel.vx() + c * vel.vy()) * dt,
                pose.theta() + vel.omega() * dt,
            )
        } else {
            volts = doubleArrayOf(0.0, 0.0, 0.0, 0.0)
            vel = BodyVel.zero()
        }
        Server.reportTick(pose, vel, volts)
        Thread.sleep(loopMs)
    }
}

private fun approach(current: Double, target: Double, alpha: Double): Double =
    current + (target - current) * alpha

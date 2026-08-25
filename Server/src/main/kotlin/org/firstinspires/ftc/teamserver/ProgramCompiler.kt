package org.firstinspires.ftc.teamserver

import com.example.teamcode.Pose
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/**
 * Mirror of worker/src/program.ts. Compiles a Program into a sequence of
 * blocks, each carrying a pose-sample path the PD controller steps through.
 * Keep the constants and geometry aligned with the TS version — the client
 * relies on them being identical so its overlay matches the executed path.
 */
object ProgramCompiler {
    const val TILE = 0.6
    const val FIELD_TILES = 6
    private const val SAMPLE_LEN = 0.02
    private val SAMPLE_ANG = Math.toRadians(2.0)

    data class Block(val blockId: String, val path: List<Pose>)

    /** Canonical start pose: bottom-center tile, facing +y (up-field). */
    fun startPose(): Pose {
        val cx = (FIELD_TILES / 2.0) * TILE
        val cy = 0.5 * TILE
        return Pose(cx, cy, PI / 2)
    }

    fun compile(start: Pose, program: ProgramMsg): List<Block> {
        val out = mutableListOf<Block>()
        var cur = start
        for (cmd in program.commands) {
            val path = pathFor(cur, cmd)
            out.add(Block(cmd.id, path))
            if (path.isNotEmpty()) cur = path.last()
        }
        return out
    }

    private fun pathFor(start: Pose, cmd: CommandMsg): List<Pose> = when (cmd.op) {
        "forward", "backward", "strafe_left", "strafe_right" -> {
            val bodyAngle = when (cmd.op) {
                "forward" -> 0.0
                "backward" -> PI
                "strafe_left" -> PI / 2
                else -> -PI / 2 // strafe_right
            }
            val worldAngle = start.theta() + bodyAngle
            val dx = cos(worldAngle) * TILE
            val dy = sin(worldAngle) * TILE
            val dist = hypot(dx, dy)
            val n = max(1, ceil(dist / SAMPLE_LEN).toInt())
            (1..n).map { i ->
                val t = i.toDouble() / n
                Pose(start.x() + dx * t, start.y() + dy * t, start.theta())
            }
        }
        "rotate" -> {
            val dtheta = Math.toRadians(cmd.degrees ?: 0.0)
            val n = max(1, ceil(abs(dtheta) / SAMPLE_ANG).toInt())
            (1..n).map { i ->
                val t = i.toDouble() / n
                Pose(start.x(), start.y(), start.theta() + dtheta * t)
            }
        }
        "return_to_start" -> {
            val goal = startPose()
            val dx = goal.x() - start.x()
            val dy = goal.y() - start.y()
            val dtheta = wrapPi(goal.theta() - start.theta())
            val dist = hypot(dx, dy)
            val n = maxOf(
                1,
                ceil(dist / SAMPLE_LEN).toInt(),
                ceil(abs(dtheta) / SAMPLE_ANG).toInt(),
            )
            (1..n).map { i ->
                val t = i.toDouble() / n
                Pose(start.x() + dx * t, start.y() + dy * t, start.theta() + dtheta * t)
            }
        }
        else -> emptyList()
    }

    private fun wrapPi(a: Double): Double {
        var x = a
        while (x > PI) x -= 2 * PI
        while (x <= -PI) x += 2 * PI
        return x
    }
}

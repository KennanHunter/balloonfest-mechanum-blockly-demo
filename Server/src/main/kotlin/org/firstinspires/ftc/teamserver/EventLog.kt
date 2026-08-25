package org.firstinspires.ftc.teamserver

/**
 * One-line-per-event logger. Off by default so the OpMode path stays quiet
 * on logcat; the standalone [Main] runner flips [enabled] on at boot.
 */
object EventLog {
    @Volatile var enabled: Boolean = false

    fun event(tag: String, msg: String) {
        if (!enabled) return
        println("[server:$tag] $msg")
    }
}

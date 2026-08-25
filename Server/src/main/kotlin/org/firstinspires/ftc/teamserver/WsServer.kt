package org.firstinspires.ftc.teamserver

import com.example.teamcode.Gains
import com.example.teamcode.Pose
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.Collections

/**
 * NanoWSD server bound to port 8081. Handles the client↔device wire
 * protocol shared with worker/src/protocol.ts. Runs alongside the RC app's
 * own web server on 8080 — deliberately on a separate port so we don't
 * fight NanoHTTPD's handler routing.
 *
 * Message parsing/serialization goes through Gson (already on the FTC
 * classpath via RobotCore). All wire-facing state changes are delegated
 * to [Handlers] so [Server] owns the actual program-cursor mutation.
 */
class WsServer(port: Int, private val handlers: Handlers) : NanoWSD(port) {

    interface Handlers {
        fun onPlay(program: ProgramMsg, newGains: Gains?)
        fun onStop()
        fun onReset()
        fun onSetGains(newGains: Gains)
        fun onClientConnected()
    }

    private val gson = Gson()
    private val sockets: MutableSet<Socket> = Collections.synchronizedSet(mutableSetOf())

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket = Socket(handshake)

    // ---- broadcast helpers ----

    fun broadcastPose(p: Pose) {
        send(jsonTagged("robot_position") {
            addProperty("x", p.x())
            addProperty("y", p.y())
            addProperty("theta", p.theta())
        })
    }

    fun broadcastTarget(p: Pose) {
        send(jsonTagged("target_position") {
            addProperty("x", p.x())
            addProperty("y", p.y())
            addProperty("theta", p.theta())
        })
    }

    fun broadcastMotors(volts: DoubleArray) {
        val motors = JsonObject().apply {
            add("fl", motorEntry(volts[0]))
            add("fr", motorEntry(volts[1]))
            add("bl", motorEntry(volts[2]))
            add("br", motorEntry(volts[3]))
        }
        send(jsonTagged("motor_power") { add("motors", motors) })
    }

    fun broadcastActive(id: String?) {
        send(jsonTagged("active_block") {
            if (id != null) addProperty("id", id) else add("id", com.google.gson.JsonNull.INSTANCE)
        })
    }

    fun broadcastActivePath(path: List<Pose>) {
        val arr = com.google.gson.JsonArray()
        for (p in path) {
            arr.add(JsonObject().apply {
                addProperty("x", p.x())
                addProperty("y", p.y())
                addProperty("theta", p.theta())
            })
        }
        send(jsonTagged("active_path") {
            add("blockId", com.google.gson.JsonNull.INSTANCE)
            add("path", arr)
        })
    }

    private fun motorEntry(v: Double): JsonObject = JsonObject().apply {
        addProperty("voltage", round3(v))
    }

    private fun round3(v: Double): Double = Math.round(v * 1000.0) / 1000.0

    private inline fun jsonTagged(type: String, build: JsonObject.() -> Unit): String {
        val obj = JsonObject()
        obj.addProperty("type", type)
        obj.build()
        return gson.toJson(obj)
    }

    private fun send(payload: String) {
        val snapshot: List<Socket> = synchronized(sockets) { sockets.toList() }
        for (s in snapshot) {
            try { s.send(payload) } catch (_: IOException) { /* dropped; close will fire */ }
        }
    }

    // ---- per-connection ----

    private inner class Socket(handshake: NanoHTTPD.IHTTPSession) : WebSocket(handshake) {
        override fun onOpen() {
            sockets.add(this)
            handlers.onClientConnected()
        }

        override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
            sockets.remove(this)
            EventLog.event("ws", "client closed (code=$code, remote=$initiatedByRemote)")
        }

        override fun onMessage(message: WebSocketFrame) {
            val text = message.textPayload ?: return
            val root = try {
                JsonParser.parseString(text).asJsonObject
            } catch (_: Exception) { return }
            val type = root.get("type")?.asString ?: return
            when (type) {
                "play" -> {
                    val program = gson.fromJson(root.get("program"), ProgramMsg::class.java) ?: return
                    val newGains = root.get("gains")?.let { parseGains(it.asJsonObject) }
                    handlers.onPlay(program, newGains)
                }
                "stop" -> handlers.onStop()
                "reset" -> handlers.onReset()
                "set_gains" -> {
                    val gains = root.get("gains")?.asJsonObject?.let(::parseGains) ?: return
                    handlers.onSetGains(gains)
                }
                else -> { /* unknown message; ignore */ }
            }
        }

        override fun onPong(pong: WebSocketFrame) {}
        override fun onException(exception: IOException) { /* logged by NanoWSD */ }
    }

    private fun parseGains(obj: JsonObject): Gains = Gains(
        obj.get("Kp_t").asDouble,
        obj.get("Kd_t").asDouble,
        obj.get("Kp_r").asDouble,
        obj.get("Kd_r").asDouble,
    )
}

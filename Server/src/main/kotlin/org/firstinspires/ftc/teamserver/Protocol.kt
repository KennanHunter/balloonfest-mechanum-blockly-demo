package org.firstinspires.ftc.teamserver

/**
 * Wire-protocol DTOs shared with worker/src/protocol.ts. Only the shapes
 * the device needs to consume live here — outgoing broadcasts are built
 * as raw JsonObjects in [WsServer] to avoid extra Gson bookkeeping.
 */

data class CommandMsg(
    val op: String,           // forward | backward | strafe_left | strafe_right | rotate | return_to_start
    val id: String,
    val degrees: Double? = null,
)

data class ProgramMsg(
    val name: String? = null,
    val commands: List<CommandMsg>,
)

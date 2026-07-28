package com.macsurfacing.workspace

internal data class FollowUpNotificationPayload(
    val id: String,
    val title: String,
    val body: String,
)

internal enum class FollowUpNotificationPermission {
    GRANTED,
    REQUESTABLE,
    DENIED,
}

internal enum class FollowUpNotificationDelivery(val wireValue: String) {
    SHOWN("shown"),
    DENIED("denied"),
}

/**
 * Holds MethodChannel calls while Android's permission dialog is open.
 *
 * The Flutter caller receives SHOWN only after [show] has run. Duplicate calls
 * for the same event are coalesced into one native notification while every
 * caller still receives an acknowledgement.
 */
internal class FollowUpNotificationDeliveryQueue(
    private val show: (FollowUpNotificationPayload) -> Unit,
    private val requestPermission: () -> Unit,
) {
    private data class Pending(
        var payload: FollowUpNotificationPayload,
        val acknowledgements: MutableList<(FollowUpNotificationDelivery) -> Unit>,
    )

    private val pending = linkedMapOf<String, Pending>()

    var isPermissionRequestInFlight: Boolean = false
        private set

    val pendingCount: Int
        get() = pending.size

    fun deliver(
        payload: FollowUpNotificationPayload,
        permission: FollowUpNotificationPermission,
        acknowledge: (FollowUpNotificationDelivery) -> Unit,
    ) {
        when (permission) {
            FollowUpNotificationPermission.GRANTED -> {
                acknowledge(showOutcome(payload))
            }
            FollowUpNotificationPermission.DENIED -> {
                acknowledge(FollowUpNotificationDelivery.DENIED)
            }
            FollowUpNotificationPermission.REQUESTABLE -> {
                val queued = pending[payload.id]
                if (queued == null) {
                    pending[payload.id] = Pending(payload, mutableListOf(acknowledge))
                } else {
                    queued.payload = payload
                    queued.acknowledgements += acknowledge
                }
                if (!isPermissionRequestInFlight) {
                    isPermissionRequestInFlight = true
                    requestPermission()
                }
            }
        }
    }

    fun resolvePermission(granted: Boolean) {
        isPermissionRequestInFlight = false
        val queued = pending.values.toList()
        pending.clear()
        val outcome =
            if (granted) {
                FollowUpNotificationDelivery.SHOWN
            } else {
                FollowUpNotificationDelivery.DENIED
            }
        for (delivery in queued) {
            val deliveryOutcome =
                if (granted) {
                    showOutcome(delivery.payload)
                } else {
                    outcome
                }
            for (acknowledge in delivery.acknowledgements) {
                acknowledge(deliveryOutcome)
            }
        }
    }

    private fun showOutcome(
        payload: FollowUpNotificationPayload,
    ): FollowUpNotificationDelivery =
        try {
            show(payload)
            FollowUpNotificationDelivery.SHOWN
        } catch (_: RuntimeException) {
            FollowUpNotificationDelivery.DENIED
        }
}

package com.macsurfacing.workspace

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FollowUpNotificationDeliveryQueueTest {
    private val payload = FollowUpNotificationPayload(
        id = "event-1",
        title = "We need you",
        body = "Confirm the evidence",
    )

    @Test
    fun `permission request queues and dedupes until grant shows once`() {
        val shown = mutableListOf<FollowUpNotificationPayload>()
        val outcomes = mutableListOf<FollowUpNotificationDelivery>()
        var requests = 0
        val queue = FollowUpNotificationDeliveryQueue(
            show = shown::add,
            requestPermission = { requests++ },
        )

        queue.deliver(
            payload,
            FollowUpNotificationPermission.REQUESTABLE,
            outcomes::add,
        )
        queue.deliver(
            payload.copy(title = "Latest title"),
            FollowUpNotificationPermission.REQUESTABLE,
            outcomes::add,
        )

        assertEquals(1, requests)
        assertEquals(1, queue.pendingCount)
        assertTrue(queue.isPermissionRequestInFlight)
        assertEquals(emptyList(), shown)
        assertEquals(emptyList(), outcomes)

        queue.resolvePermission(granted = true)

        assertEquals(listOf("Latest title"), shown.map { it.title })
        assertEquals(
            listOf(
                FollowUpNotificationDelivery.SHOWN,
                FollowUpNotificationDelivery.SHOWN,
            ),
            outcomes,
        )
        assertEquals(0, queue.pendingCount)
        assertFalse(queue.isPermissionRequestInFlight)
    }

    @Test
    fun `denial acknowledges without showing and a later granted retry shows`() {
        val shown = mutableListOf<FollowUpNotificationPayload>()
        val outcomes = mutableListOf<FollowUpNotificationDelivery>()
        val queue = FollowUpNotificationDeliveryQueue(
            show = shown::add,
            requestPermission = {},
        )

        queue.deliver(
            payload,
            FollowUpNotificationPermission.DENIED,
            outcomes::add,
        )
        assertEquals(listOf(FollowUpNotificationDelivery.DENIED), outcomes)
        assertEquals(emptyList(), shown)

        queue.deliver(
            payload,
            FollowUpNotificationPermission.GRANTED,
            outcomes::add,
        )
        assertEquals(listOf(payload), shown)
        assertEquals(
            listOf(
                FollowUpNotificationDelivery.DENIED,
                FollowUpNotificationDelivery.SHOWN,
            ),
            outcomes,
        )
    }

    @Test
    fun `denied permission result releases queued callers without showing`() {
        val shown = mutableListOf<FollowUpNotificationPayload>()
        val outcomes = mutableListOf<FollowUpNotificationDelivery>()
        val queue = FollowUpNotificationDeliveryQueue(
            show = shown::add,
            requestPermission = {},
        )

        queue.deliver(
            payload,
            FollowUpNotificationPermission.REQUESTABLE,
            outcomes::add,
        )
        queue.resolvePermission(granted = false)

        assertEquals(emptyList(), shown)
        assertEquals(listOf(FollowUpNotificationDelivery.DENIED), outcomes)
        assertEquals(0, queue.pendingCount)
    }

    @Test
    fun `native post failure is reported as denied`() {
        val outcomes = mutableListOf<FollowUpNotificationDelivery>()
        val queue = FollowUpNotificationDeliveryQueue(
            show = { error("notifications disabled") },
            requestPermission = {},
        )

        queue.deliver(
            payload,
            FollowUpNotificationPermission.GRANTED,
            outcomes::add,
        )

        assertEquals(listOf(FollowUpNotificationDelivery.DENIED), outcomes)
    }
}

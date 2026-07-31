package com.macsurfacing.workspace

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.media.MediaExtractor
import android.media.MediaMuxer
import android.os.Build
import androidx.annotation.RequiresApi
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

internal object AndroidImageProcessor {
    fun decodeSrgbBitmap(bytes: ByteArray): Bitmap? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            decodeSrgbBitmapWithColorManagement(bytes)
        } else {
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun decodeSrgbBitmapWithColorManagement(bytes: ByteArray): Bitmap? {
        val decoded = decodeColorManagedBitmap(bytes) ?: return null
        val srgb = ColorSpace.get(ColorSpace.Named.SRGB)
        if (decoded.config == Bitmap.Config.ARGB_8888 && decoded.colorSpace == srgb) return decoded

        val srgbBitmap = Bitmap.createBitmap(
            decoded.width,
            decoded.height,
            Bitmap.Config.ARGB_8888,
            decoded.hasAlpha(),
            srgb,
        )
        Canvas(srgbBitmap).drawBitmap(decoded, 0f, 0f, null)
        return srgbBitmap
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun decodeColorManagedBitmap(bytes: ByteArray): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            runCatching {
                val source = ImageDecoder.createSource(ByteBuffer.wrap(bytes))
                ImageDecoder.decodeBitmap(source) { decoder, _, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
                }
            }.getOrNull()?.let { return it }
        }

        val options = BitmapFactory.Options().apply {
            inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    fun encodeAndScrub(
        bitmap: Bitmap,
        format: Bitmap.CompressFormat,
    ): ByteArray? {
        val output = ByteArrayOutputStream()
        if (!bitmap.compress(format, 100, output)) return null

        return when (format) {
            Bitmap.CompressFormat.PNG -> AndroidMediaSanitizer.scrubPng(output.toByteArray())
            Bitmap.CompressFormat.JPEG -> AndroidMediaSanitizer.scrubJpeg(output.toByteArray())
            else -> error("Unsupported upload image format: $format")
        }
    }
}

class MainActivity : FlutterActivity() {
    private var mediaUploadChannel: MethodChannel? = null
    private var followUpNotificationChannel: MethodChannel? = null
    private lateinit var followUpNotificationDeliveryQueue: FollowUpNotificationDeliveryQueue

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        mediaUploadChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            MEDIA_UPLOAD_CHANNEL,
        ).also { channel ->
            channel.setMethodCallHandler { call, result ->
                when (call.method) {
                    SANITIZE_IMAGE_FOR_UPLOAD_METHOD -> {
                        handleSanitizeImageForUpload(call.arguments, result)
                    }
                    TRANSCODE_IMAGE_TO_JPEG_METHOD -> {
                        handleTranscodeImageToJpeg(call.arguments, result)
                    }
                    TRANSCODE_VIDEO_TO_MP4_METHOD -> {
                        handleTranscodeVideoToMp4(call.arguments, result)
                    }
                    REQUIRES_LEGACY_MEDIA_STORAGE_PERMISSION_METHOD -> {
                        result.success(Build.VERSION.SDK_INT <= Build.VERSION_CODES.P)
                    }
                    else -> result.notImplemented()
                }
            }
        }

        ensureFollowUpNotificationChannel()
        followUpNotificationDeliveryQueue = FollowUpNotificationDeliveryQueue(
            show = ::postFollowUpNotification,
            requestPermission = {
                getSharedPreferences(FOLLOW_UP_NOTIFICATION_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(FOLLOW_UP_PERMISSION_REQUESTED_KEY, true)
                    .apply()
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    FOLLOW_UP_PERMISSION_REQUEST_CODE,
                )
            },
        )
        followUpNotificationChannel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            FOLLOW_UP_NOTIFICATION_CHANNEL,
        ).also { channel ->
            channel.setMethodCallHandler { call, result ->
                if (call.method != "show") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val payload = call.arguments as? Map<*, *>
                val id = payload?.get("id") as? String
                val title = payload?.get("title") as? String
                val body = payload?.get("body") as? String
                if (id == null || title == null || body == null) {
                    invalidArguments(result, "Expected notification id, title, and body.")
                    return@setMethodCallHandler
                }
                followUpNotificationDeliveryQueue.deliver(
                    FollowUpNotificationPayload(id, title, body),
                    followUpNotificationPermission(),
                ) { delivery ->
                    result.success(delivery.wireValue)
                }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (
            requestCode == FOLLOW_UP_PERMISSION_REQUEST_CODE &&
            ::followUpNotificationDeliveryQueue.isInitialized
        ) {
            followUpNotificationDeliveryQueue.resolvePermission(
                grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED,
            )
        }
    }

    private fun ensureFollowUpNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                FOLLOW_UP_ANDROID_CHANNEL_ID,
                "My Actions",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Questions and checks that need your attention"
            },
        )
    }

    private fun followUpNotificationPermission(): FollowUpNotificationPermission {
        val permissionGranted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        if (permissionGranted && followUpNotificationsEnabled()) {
            return FollowUpNotificationPermission.GRANTED
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return FollowUpNotificationPermission.DENIED
        }
        if (
            ::followUpNotificationDeliveryQueue.isInitialized &&
            followUpNotificationDeliveryQueue.isPermissionRequestInFlight
        ) {
            return FollowUpNotificationPermission.REQUESTABLE
        }
        val requested = getSharedPreferences(
            FOLLOW_UP_NOTIFICATION_PREFS,
            Context.MODE_PRIVATE,
        ).getBoolean(FOLLOW_UP_PERMISSION_REQUESTED_KEY, false)
        return if (requested) {
            FollowUpNotificationPermission.DENIED
        } else {
            FollowUpNotificationPermission.REQUESTABLE
        }
    }

    private fun followUpNotificationsEnabled(): Boolean {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true
        return manager.getNotificationChannel(FOLLOW_UP_ANDROID_CHANNEL_ID)?.importance !=
            NotificationManager.IMPORTANCE_NONE
    }

    private fun postFollowUpNotification(payload: FollowUpNotificationPayload) {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, FOLLOW_UP_ANDROID_CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setAutoCancel(true)
            .build()
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(payload.id.hashCode(), notification)
    }

    private fun handleSanitizeImageForUpload(
        arguments: Any?,
        result: MethodChannel.Result,
    ) {
        val payload = arguments as? Map<*, *> ?: run {
            invalidArguments(result, "Expected image bytes and mime type.")
            return
        }
        val bytes = payload["bytes"] as? ByteArray ?: run {
            invalidArguments(result, "Expected raw image bytes.")
            return
        }
        val mimeType = payload["mimeType"] as? String ?: run {
            invalidArguments(result, "Expected image mime type.")
            return
        }

        val format = sanitizeCompressFormatFor(mimeType)
        if (format == null) {
            result.error(
                "sanitize_failed",
                "Unable to sanitize picked image.",
                mimeType,
            )
            return
        }

        transformImageBytes(
            bytes = bytes,
            result = result,
            format = format,
            errorCode = "sanitize_failed",
            encodeFailureMessage = "Unable to sanitize picked image.",
            errorDetails = mimeType,
        )
    }

    private fun handleTranscodeImageToJpeg(
        arguments: Any?,
        result: MethodChannel.Result,
    ) {
        val bytes = arguments as? ByteArray ?: run {
            invalidArguments(result, "Expected raw image bytes.")
            return
        }

        transformImageBytes(
            bytes = bytes,
            result = result,
            format = Bitmap.CompressFormat.JPEG,
            errorCode = "transcode_failed",
            encodeFailureMessage = "Unable to convert picked image to JPEG.",
        )
    }

    private fun sanitizeCompressFormatFor(
        mimeType: String,
    ): Bitmap.CompressFormat? {
        return when (mimeType) {
            "image/jpeg" -> Bitmap.CompressFormat.JPEG
            "image/png", "image/webp" -> Bitmap.CompressFormat.PNG
            else -> null
        }
    }

    private fun transformImageBytes(
        bytes: ByteArray,
        result: MethodChannel.Result,
        format: Bitmap.CompressFormat,
        errorCode: String,
        encodeFailureMessage: String,
        errorDetails: Any? = null,
    ) {
        val bitmap = AndroidImageProcessor.decodeSrgbBitmap(bytes) ?: run {
            result.error(
                errorCode,
                "Unable to decode picked image.",
                null,
            )
            return
        }

        val transformedBytes = try {
            AndroidImageProcessor.encodeAndScrub(bitmap, format)
        } catch (_: IllegalArgumentException) {
            null
        } ?: run {
            result.error(
                errorCode,
                encodeFailureMessage,
                errorDetails,
            )
            return
        }

        result.success(transformedBytes)
    }

    private fun handleTranscodeVideoToMp4(
        arguments: Any?,
        result: MethodChannel.Result,
    ) {
        val sourcePath = arguments as? String ?: run {
            invalidArguments(result, "Expected source file path as String.")
            return
        }

        Thread {
            val outputFile = File(cacheDir, "${UUID.randomUUID()}.mp4")
            var muxer: MediaMuxer? = null
            val extractor = MediaExtractor()
            try {
                extractor.setDataSource(sourcePath)
                muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

                val trackIndices = mutableMapOf<Int, Int>()
                var copiedVideo = false
                var copiedAudio = false
                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(android.media.MediaFormat.KEY_MIME) ?: continue
                    val isVideo = mime.startsWith("video/")
                    val isAudio = mime.startsWith("audio/")
                    if ((!isVideo && !isAudio) || (isVideo && copiedVideo) || (isAudio && copiedAudio)) {
                        continue
                    }
                    val newIndex = muxer.addTrack(format)
                    trackIndices[i] = newIndex
                    extractor.selectTrack(i)
                    copiedVideo = copiedVideo || isVideo
                    copiedAudio = copiedAudio || isAudio
                }

                muxer.start()
                val buffer = ByteBuffer.allocate(1024 * 1024) // 1MB buffer
                val bufferInfo = android.media.MediaCodec.BufferInfo()

                while (true) {
                    val sampleSize = extractor.readSampleData(buffer, 0)
                    if (sampleSize < 0) break
                    val muxerTrack = trackIndices[extractor.sampleTrackIndex]
                    if (muxerTrack == null) {
                        extractor.advance()
                        continue
                    }
                    bufferInfo.offset = 0
                    bufferInfo.size = sampleSize
                    bufferInfo.presentationTimeUs = extractor.sampleTime
                    bufferInfo.flags = extractor.sampleFlags
                    muxer.writeSampleData(muxerTrack, buffer, bufferInfo)
                    extractor.advance()
                }

                muxer.stop()
                result.success(outputFile.absolutePath)
            } catch (e: Exception) {
                outputFile.delete()
                result.error(
                    "transcode_failed",
                    e.message ?: "Video transcoding failed.",
                    null,
                )
            } finally {
                try { muxer?.release() } catch (_: Exception) {}
                extractor.release()
            }
        }.start()
    }

    private fun invalidArguments(
        result: MethodChannel.Result,
        message: String,
    ) {
        result.error("invalid_arguments", message, null)
    }

    companion object {
        private const val MEDIA_UPLOAD_CHANNEL = "buzz/media_upload"
        private const val SANITIZE_IMAGE_FOR_UPLOAD_METHOD = "sanitizeImageForUpload"
        private const val TRANSCODE_IMAGE_TO_JPEG_METHOD = "transcodeImageToJpeg"
        private const val TRANSCODE_VIDEO_TO_MP4_METHOD = "transcodeVideoToMp4"
        private const val FOLLOW_UP_NOTIFICATION_CHANNEL = "buzz/cos_follow_up_notifications"
        private const val FOLLOW_UP_ANDROID_CHANNEL_ID = "cos-follow-up-actions"
        private const val FOLLOW_UP_NOTIFICATION_PREFS = "cos-follow-up-notifications"
        private const val FOLLOW_UP_PERMISSION_REQUESTED_KEY = "permission-requested"
        private const val FOLLOW_UP_PERMISSION_REQUEST_CODE = 47010
        private const val REQUIRES_LEGACY_MEDIA_STORAGE_PERMISSION_METHOD =
            "requiresLegacyMediaStoragePermission"
    }
}

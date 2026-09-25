package com.example.nexus_ai

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.UUID

class MainActivity : FlutterActivity() {
    private val channelName = "nexus/video_picker"
    private val pickVideoRequest = 4207
    private val maxVideoBytes = 100L * 1024L * 1024L
    private var pendingPickerResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "pickVideo" -> openVideoPicker(result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun openVideoPicker(result: MethodChannel.Result) {
        if (pendingPickerResult != null) {
            result.error("picker_busy", "O seletor de vídeo já está aberto.", null)
            return
        }

        pendingPickerResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("video/mp4", "video/quicktime", "video/webm", "video/x-matroska")
            )
        }

        try {
            startActivityForResult(intent, pickVideoRequest)
        } catch (error: Exception) {
            pendingPickerResult = null
            result.error("picker_unavailable", "Não foi possível abrir os vídeos do aparelho.", error.message)
        }
    }

    @Deprecated("Deprecated in Android SDK but required by FlutterActivity result flow")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != pickVideoRequest) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }

        val result = pendingPickerResult
        pendingPickerResult = null

        if (result == null) return
        if (resultCode != Activity.RESULT_OK) {
            result.success(null)
            return
        }

        val uri = data?.data
        if (uri == null) {
            result.error("picker_empty", "Nenhum vídeo foi selecionado.", null)
            return
        }

        try {
            result.success(copySelectedVideo(uri))
        } catch (error: Exception) {
            val code = if (error.message == "video_too_large") "video_too_large" else "picker_copy_failed"
            val message = if (code == "video_too_large") {
                "O vídeo ultrapassa o limite de 100 MB."
            } else {
                "Não foi possível preparar o vídeo selecionado."
            }
            result.error(code, message, error.message)
        }
    }

    private fun copySelectedVideo(uri: Uri): Map<String, Any> {
        var displayName = "video.mp4"
        var declaredSize = -1L

        contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) {
                    displayName = cursor.getString(nameIndex) ?: displayName
                }
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    declaredSize = cursor.getLong(sizeIndex)
                }
            }
        }

        if (declaredSize > maxVideoBytes) throw IllegalStateException("video_too_large")

        val mimeType = contentResolver.getType(uri) ?: mimeFromName(displayName)
        val cleanName = displayName
            .replace(Regex("[\\\\/\\u0000-\\u001F\\u007F]+"), "_")
            .take(180)
            .ifBlank { "video.mp4" }

        val directory = File(cacheDir, "picked_videos").apply { mkdirs() }
        val target = File(directory, UUID.randomUUID().toString() + "-" + cleanName)

        contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output ->
                val buffer = ByteArray(1024 * 1024)
                var total = 0L
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    total += read
                    if (total > maxVideoBytes) {
                        target.delete()
                        throw IllegalStateException("video_too_large")
                    }
                    output.write(buffer, 0, read)
                }
            }
        } ?: throw IllegalStateException("video_stream_unavailable")

        val size = target.length()
        if (size <= 0L) {
            target.delete()
            throw IllegalStateException("video_empty")
        }

        return mapOf(
            "path" to target.absolutePath,
            "name" to cleanName,
            "size" to size,
            "contentType" to mimeType
        )
    }

    private fun mimeFromName(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".mov") -> "video/quicktime"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".mkv") -> "video/x-matroska"
            else -> "video/mp4"
        }
    }
}

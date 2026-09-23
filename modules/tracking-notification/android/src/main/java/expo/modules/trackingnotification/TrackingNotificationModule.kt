package expo.modules.trackingnotification

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ActionSpec : Record {
  @Field val id: String = ""
  @Field val title: String = ""
}

class ControlsSpec : Record {
  @Field val title: String = ""
  @Field val body: String = ""
  @Field val channelId: String = ""
  @Field val promote: Boolean = false
  @Field val chipText: String? = null
  @Field val actions: List<ActionSpec> = emptyList()
}

// Puts the Mark stop / End day buttons on the tracking notification itself.
//
// expo-location posts the foreground-service notification Android requires
// while tracking, and it has no way to add buttons. An app may repost its own
// foreground-service notification under the same id, so this finds that one
// and replaces it. With no tracking service running (tracking stopped, or a
// day left open overnight) it posts under FALLBACK_ID instead.
//
// expo-location reposts its plain version whenever the service restarts, so
// show() is called on every GPS batch. It's a no-op unless the notification
// is missing or its text changed.
class TrackingNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("TrackingNotification")

    // Returns true if it posted, false if the right one was already showing.
    Function("show") { spec: ControlsSpec ->
      val key = listOf(spec.title, spec.body, spec.channelId, spec.promote, spec.chipText,
        spec.actions.joinToString(",") { it.id + "=" + it.title }).joinToString("|")
      // expo-notifications posts with a tag; the service and this module don't.
      val active = manager.activeNotifications.filter { it.tag == null }
      val service = active.firstOrNull { it.notification.flags and Notification.FLAG_FOREGROUND_SERVICE != 0 }
      val id = service?.id ?: FALLBACK_ID
      // The service's id goes up by one each time it starts within the same
      // process, so an earlier copy may be sitting under a different id.
      active.filter { it.id != id && it.notification.extras.getString(EXTRA_KEY) != null }
        .forEach { manager.cancel(it.id) }
      if (active.firstOrNull { it.id == id }?.notification?.extras?.getString(EXTRA_KEY) == key) {
        return@Function false
      }
      manager.notify(id, build(spec, key))
      true
    }

    Function("hide") {
      // Cancelling a running service's notification is ignored; the service
      // takes it down itself when tracking stops.
      manager.activeNotifications
        .filter { it.tag == null && it.notification.extras.getString(EXTRA_KEY) != null }
        .forEach { manager.cancel(it.id) }
    }
  }

  private fun build(spec: ControlsSpec, key: String): Notification {
    val postedAt = System.currentTimeMillis()
    val builder = NotificationCompat.Builder(context, spec.channelId)
      .setSmallIcon(icon())
      .setContentTitle(spec.title)
      .setContentText(spec.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(spec.body))
      // Color only tints the icon and buttons. Colorizing the whole card
      // (what expo-location does) disqualifies it from being a Live Update.
      .setColor(Color.parseColor("#1b7f3b"))
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(open(null, postedAt, 0))
      .setRequestPromotedOngoing(spec.promote)
      .addExtras(android.os.Bundle().apply { putString(EXTRA_KEY, key) })
    spec.chipText?.let { builder.setShortCriticalText(it) }
    spec.actions.forEachIndexed { i, a ->
      builder.addAction(0, a.title, open(a.id, postedAt, i + 1))
    }
    return builder.build()
  }

  // Opens the app. For a button, the URL reaches JS through React Native's
  // Linking (getInitialURL on a cold start, a 'url' event otherwise). The
  // intent names the activity directly, so no URL scheme is registered and
  // no other app can send these.
  private fun open(action: String?, postedAt: Long, requestCode: Int): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    if (action != null) {
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("mileagelog://action/$action?n=$postedAt")
    }
    return PendingIntent.getActivity(context, requestCode, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  // Same icon choice as expo-location and expo-notifications.
  private fun icon(): Int =
    context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon

  companion object {
    // expo-location's first service id; any unused int would do.
    private const val FALLBACK_ID = 481756
    private const val EXTRA_KEY = "mileagelog.controlsKey"
  }
}

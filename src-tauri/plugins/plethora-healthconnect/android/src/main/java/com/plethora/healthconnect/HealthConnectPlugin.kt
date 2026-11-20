package com.plethora.healthconnect

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.time.Instant
import java.time.ZoneOffset
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@InvokeArg
class AuthArgs {
  var categories: Array<String> = emptyArray()
  var includeHistory: Boolean = false
  var includeBackground: Boolean = false
}

@InvokeArg
class QueryArgs {
  var startMs: Long = 0
  var endMs: Long = 0
  var categories: Array<String>? = null
  var changesToken: String? = null
}

@InvokeArg
class TokenArgs {
  var categories: Array<String> = emptyArray()
}

@InvokeArg
class ChangesArgs {
  var changesToken: String? = null
}

/** Shown by Android Health Connect when the user taps "Privacy policy" / rationale. */
class PermissionsRationaleActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    AlertDialog.Builder(this)
      .setTitle("Plethora and Health Connect")
      .setMessage("Plethora uses the sleep, heart rate, and activity data you choose to share to show your sleep history and compare it with study activity. These records stay in a separate local vault. You can revoke access in Health Connect and delete imported records in Plethora.")
      .setPositiveButton(android.R.string.ok) { _, _ -> finish() }
      .setOnCancelListener { finish() }
      .show()
  }
}

@TauriPlugin
class HealthConnectPlugin(private val activity: Activity) : Plugin(activity) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private fun clientOrReject(invoke: Invoke): HealthConnectClient? {
    val status = HealthConnectClient.getSdkStatus(activity)
    if (status != HealthConnectClient.SDK_AVAILABLE) {
      val code = if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        "provider_update_required"
      } else {
        "sdk_unavailable"
      }
      invoke.reject("Health Connect unavailable ($code)", code)
      return null
    }
    return HealthConnectClient.getOrCreate(activity)
  }

  private fun permissionsFor(
    categories: List<String>,
    includeHistory: Boolean,
    includeBackground: Boolean,
  ): Set<String> {
    val perms = mutableSetOf<String>()
    val cats = if (categories.isEmpty()) listOf("sleep") else categories
    for (cat in cats) {
      when (cat) {
        "sleep", "sleep_stages" -> perms.add(HealthPermission.getReadPermission(SleepSessionRecord::class))
        "heart_rate" -> perms.add(HealthPermission.getReadPermission(HeartRateRecord::class))
        "resting_heart_rate" -> perms.add(HealthPermission.getReadPermission(RestingHeartRateRecord::class))
        "hrv" -> perms.add(HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class))
        "activity" -> {
          perms.add(HealthPermission.getReadPermission(StepsRecord::class))
          perms.add(HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class))
        }
      }
    }
    if (includeHistory) {
      perms.add(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
    }
    if (includeBackground) {
      perms.add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
    }
    return perms
  }

  private fun recordTypesFor(categories: List<String>): Set<KClass<out Record>> {
    val types = mutableSetOf<KClass<out Record>>()
    val cats = if (categories.isEmpty()) listOf("sleep") else categories
    for (cat in cats) {
      when (cat) {
        "sleep", "sleep_stages" -> types.add(SleepSessionRecord::class)
        "heart_rate" -> types.add(HeartRateRecord::class)
        "resting_heart_rate" -> types.add(RestingHeartRateRecord::class)
        "hrv" -> types.add(HeartRateVariabilityRmssdRecord::class)
        "activity" -> {
          types.add(StepsRecord::class)
          types.add(ActiveCaloriesBurnedRecord::class)
        }
      }
    }
    return types
  }

  private fun mapStageType(stage: Int): Pair<String, String> = when (stage) {
    SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake" to "STAGE_TYPE_AWAKE"
    SleepSessionRecord.STAGE_TYPE_SLEEPING -> "asleep_unknown" to "STAGE_TYPE_SLEEPING"
    SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "awake" to "STAGE_TYPE_OUT_OF_BED"
    SleepSessionRecord.STAGE_TYPE_LIGHT -> "light" to "STAGE_TYPE_LIGHT"
    SleepSessionRecord.STAGE_TYPE_DEEP -> "deep" to "STAGE_TYPE_DEEP"
    SleepSessionRecord.STAGE_TYPE_REM -> "rem" to "STAGE_TYPE_REM"
    SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "in_bed" to "STAGE_TYPE_AWAKE_IN_BED"
    else -> "unknown" to "STAGE_TYPE_$stage"
  }

  private fun serializeSleepSession(rec: SleepSessionRecord): JSObject {
    val stagesArr = JSArray()
    for (st in rec.stages) {
      val (stageName, code) = mapStageType(st.stage)
      val stObj = JSObject()
      stObj.put("stageType", stageName)
      stObj.put("providerStageCode", code)
      stObj.put("startAtMs", st.startTime.toEpochMilli())
      stObj.put("endAtMs", st.endTime.toEpochMilli())
      stagesArr.put(stObj)
    }

    val obj = JSObject()
    obj.put("id", rec.metadata.id)
    obj.put("dataOriginPackage", rec.metadata.dataOrigin.packageName)
    obj.put("deviceManufacturer", rec.metadata.device?.manufacturer)
    obj.put("deviceModel", rec.metadata.device?.model)
    obj.put("startAtMs", rec.startTime.toEpochMilli())
    obj.put("endAtMs", rec.endTime.toEpochMilli())
    obj.put("startZoneOffsetSecs", rec.startZoneOffset?.totalSeconds)
    obj.put("endZoneOffsetSecs", rec.endZoneOffset?.totalSeconds)
    obj.put("title", rec.title)
    obj.put("notes", rec.notes)
    obj.put("stages", stagesArr)
    return obj
  }

  private fun serializePhysioRecord(rec: Record): List<JSObject> {
    val out = mutableListOf<JSObject>()
    val originPkg = rec.metadata.dataOrigin.packageName
    val manufacturer = rec.metadata.device?.manufacturer
    val model = rec.metadata.device?.model

    fun baseObj(extId: String, metric: String, value: Double, unit: String, time: Instant, offset: ZoneOffset?): JSObject {
      val o = JSObject()
      o.put("id", extId)
      o.put("dataOriginPackage", originPkg)
      o.put("deviceManufacturer", manufacturer)
      o.put("deviceModel", model)
      o.put("metricType", metric)
      o.put("value", value)
      o.put("unit", unit)
      o.put("measuredAtMs", time.toEpochMilli())
      o.put("tzOffsetSecs", offset?.totalSeconds)
      return o
    }

    when (rec) {
      is HeartRateVariabilityRmssdRecord -> {
        val o = baseObj(rec.metadata.id, "hrv", rec.heartRateVariabilityMillis, "ms", rec.time, rec.zoneOffset)
        o.put("hrvMethod", "rmssd")
        out.add(o)
      }
      is RestingHeartRateRecord -> {
        out.add(baseObj(rec.metadata.id, "resting_heart_rate", rec.beatsPerMinute.toDouble(), "bpm", rec.time, rec.zoneOffset))
      }
      is HeartRateRecord -> {
        rec.samples.forEachIndexed { idx, s ->
          out.add(baseObj("${rec.metadata.id}_$idx", "heart_rate", s.beatsPerMinute.toDouble(), "bpm", s.time, rec.startZoneOffset))
        }
      }
      is StepsRecord -> {
        val o = baseObj(rec.metadata.id, "steps", rec.count.toDouble(), "count", rec.endTime, rec.endZoneOffset)
        o.put("periodStartMs", rec.startTime.toEpochMilli())
        o.put("periodEndMs", rec.endTime.toEpochMilli())
        out.add(o)
      }
      is ActiveCaloriesBurnedRecord -> {
        val o = baseObj(rec.metadata.id, "active_calories", rec.energy.inKilocalories, "kcal", rec.endTime, rec.endZoneOffset)
        o.put("periodStartMs", rec.startTime.toEpochMilli())
        o.put("periodEndMs", rec.endTime.toEpochMilli())
        out.add(o)
      }
    }
    return out
  }

  private fun permissionPayload(granted: Set<String>): JSObject {
    val cats = JSArray()
    if (granted.contains(HealthPermission.getReadPermission(SleepSessionRecord::class))) {
      cats.put("sleep")
      cats.put("sleep_stages")
    }
    if (granted.contains(HealthPermission.getReadPermission(HeartRateRecord::class))) cats.put("heart_rate")
    if (granted.contains(HealthPermission.getReadPermission(RestingHeartRateRecord::class))) cats.put("resting_heart_rate")
    if (granted.contains(HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class))) cats.put("hrv")
    if (granted.contains(HealthPermission.getReadPermission(StepsRecord::class)) || granted.contains(HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class))) cats.put("activity")

    val permsArr = JSArray()
    granted.forEach { permsArr.put(it) }

    val obj = JSObject()
    obj.put("grantedCategories", cats)
    obj.put("grantedPermissions", permsArr)
    obj.put("hasHistoryPermission", granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY))
    obj.put("hasBackgroundPermission", granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND))
    obj.put("defaultHistoryDays", 30)
    return obj
  }

  @Command
  fun getSdkStatus(invoke: Invoke) {
    val sdkStatus = HealthConnectClient.getSdkStatus(activity)
    val (statusStr, available, reason) = when (sdkStatus) {
      HealthConnectClient.SDK_AVAILABLE -> Triple("available", true, null)
      HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> Triple(
        "provider_update_required",
        false,
        "Health Connect app update required on this Android device",
      )
      else -> Triple("unavailable", false, "Health Connect is not installed or supported on this Android version")
    }
    val res = JSObject()
    res.put("status", statusStr)
    res.put("available", available)
    res.put("reason", reason)
    invoke.resolve(res)
  }

  @Command
  fun getGrantedPermissions(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    scope.launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        invoke.resolve(permissionPayload(granted))
      } catch (e: Exception) {
        invoke.reject("Failed querying Health Connect permissions: ${e.message}", "permission_error")
      }
    }
  }

  @Command
  fun requestHealthPermissions(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    val args = invoke.parseArgs(AuthArgs::class.java)
    val requested = permissionsFor(args.categories.toList(), args.includeHistory, args.includeBackground)
    val contract = PermissionController.createRequestPermissionResultContract()
    val intent = contract.createIntent(activity, requested)
    startActivityForResult(invoke, intent, "onPermissionResult")
  }

  @ActivityCallback
  fun onPermissionResult(invoke: Invoke, result: ActivityResult) {
    val client = clientOrReject(invoke) ?: return
    scope.launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        invoke.resolve(permissionPayload(granted))
      } catch (e: Exception) {
        invoke.reject("Failed inspecting granted Health Connect permissions: ${e.message}", "permission_error")
      }
    }
  }

  @Command
  fun readSleepSessions(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    val args = invoke.parseArgs(QueryArgs::class.java)
    scope.launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        val filter = TimeRangeFilter.between(
          Instant.ofEpochMilli(args.startMs),
          Instant.ofEpochMilli(args.endMs),
        )
        val sessionsArr = JSArray()
        var pageToken: String? = null
        do {
          val resp = client.readRecords(
            ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = filter, pageToken = pageToken)
          )
          for (rec in resp.records) {
            sessionsArr.put(serializeSleepSession(rec))
          }
          pageToken = resp.pageToken
        } while (pageToken != null)

        val out = JSObject()
        out.put("sleepSessions", sessionsArr)
        out.put("hasHistoryPermission", granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY))
        invoke.resolve(out)
      } catch (e: Exception) {
        invoke.reject("Failed reading Health Connect sleep sessions: ${e.message}", "read_error")
      }
    }
  }

  @Command
  fun readPhysiologicalRecords(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    val args = invoke.parseArgs(QueryArgs::class.java)
    val cats = args.categories?.toList() ?: listOf("heart_rate", "resting_heart_rate", "hrv", "activity")
    scope.launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        val filter = TimeRangeFilter.between(
          Instant.ofEpochMilli(args.startMs),
          Instant.ofEpochMilli(args.endMs),
        )
        val recordsArr = JSArray()
        for (recClass in recordTypesFor(cats)) {
          if (recClass == SleepSessionRecord::class) continue
          val perm = HealthPermission.getReadPermission(recClass)
          if (!granted.contains(perm)) continue
          var pageToken: String? = null
          do {
            val resp = client.readRecords(
              ReadRecordsRequest(recClass, timeRangeFilter = filter, pageToken = pageToken)
            )
            for (rec in resp.records) {
              for (serialized in serializePhysioRecord(rec)) {
                recordsArr.put(serialized)
              }
            }
            pageToken = resp.pageToken
          } while (pageToken != null)
        }
        val out = JSObject()
        out.put("physioRecords", recordsArr)
        out.put("hasHistoryPermission", granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY))
        invoke.resolve(out)
      } catch (e: Exception) {
        invoke.reject("Failed reading Health Connect physiological records: ${e.message}", "read_error")
      }
    }
  }

  @Command
  fun getChangesToken(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    val args = invoke.parseArgs(TokenArgs::class.java)
    scope.launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        val types = recordTypesFor(args.categories.toList())
          .filterTo(mutableSetOf()) { granted.contains(HealthPermission.getReadPermission(it)) }
        val token = client.getChangesToken(ChangesTokenRequest(recordTypes = types))
        val out = JSObject()
        out.put("changesToken", token)
        invoke.resolve(out)
      } catch (e: Exception) {
        invoke.reject("Failed acquiring Health Connect changes token: ${e.message}", "token_error")
      }
    }
  }

  @Command
  fun readChanges(invoke: Invoke) {
    val client = clientOrReject(invoke) ?: return
    val args = invoke.parseArgs(ChangesArgs::class.java)
    val token = args.changesToken
    if (token.isNullOrBlank()) {
      invoke.reject("Missing changesToken", "invalid_input")
      return
    }
    scope.launch {
      try {
        val sleepArr = JSArray()
        val physioArr = JSArray()
        val deletedIds = JSArray()
        var currentToken: String = token
        var tokenExpired = false

        do {
          val resp = client.getChanges(currentToken)
          if (resp.changesTokenExpired) {
            tokenExpired = true
            break
          }
          for (change in resp.changes) {
            when (change) {
              is UpsertionChange -> {
                val rec = change.record
                if (rec is SleepSessionRecord) {
                  sleepArr.put(serializeSleepSession(rec))
                } else {
                  for (serialized in serializePhysioRecord(rec)) {
                    physioArr.put(serialized)
                  }
                }
              }
              is DeletionChange -> deletedIds.put(change.recordId)
            }
          }
          currentToken = resp.nextChangesToken
        } while (resp.hasMore)

        val out = JSObject()
        out.put("sleepSessions", sleepArr)
        out.put("physioRecords", physioArr)
        out.put("deletedIds", deletedIds)
        out.put("nextChangesToken", currentToken)
        out.put("changesTokenExpired", tokenExpired)
        invoke.resolve(out)
      } catch (e: Exception) {
        invoke.reject("Failed reading Health Connect changes: ${e.message}", "changes_error")
      }
    }
  }
}

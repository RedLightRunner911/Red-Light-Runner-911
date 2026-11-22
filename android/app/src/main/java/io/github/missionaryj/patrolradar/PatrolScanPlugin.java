package io.github.missionaryj.patrolradar;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/** Bridge between the web UI and ScanService. Passive scan only. */
@CapacitorPlugin(name = "PatrolScan", permissions = {
    @Permission(alias = "ble", strings = { Manifest.permission.BLUETOOTH_SCAN }),
    @Permission(alias = "legacyBle", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
})
public class PatrolScanPlugin extends Plugin {

    @Override public void load() {
        ScanService.sink = new ScanService.Sink() {
            @Override public void onAdvert(JSONObject a) {
                try { notifyListeners("advert", JSObject.fromJSONObject(a)); } catch (Exception ignored) { }
            }
            @Override public void onWifi(JSONObject m) {
                try { notifyListeners("wifi", JSObject.fromJSONObject(m)); } catch (Exception ignored) { }
            }
            @Override public void onState(String st, String d) { JSObject o = new JSObject(); o.put("state", st); o.put("detail", d); notifyListeners("state", o); }
        };
    }

    private String[] aliases() {
        List<String> a = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) a.add("ble"); else a.add("legacyBle"); // Android 11 and older need location to scan
        a.add("location"); // for the user's own map position (display only)
        if (Build.VERSION.SDK_INT >= 33) a.add("notifications");
        return a.toArray(new String[0]);
    }
    private JSObject result() {
        JSObject r = new JSObject();
        PermissionState ble = Build.VERSION.SDK_INT >= 31 ? getPermissionState("ble") : getPermissionState("legacyBle");
        r.put("ble", ble.toString());
        r.put("location", getPermissionState("location").toString());
        r.put("notifications", Build.VERSION.SDK_INT >= 33 ? getPermissionState("notifications").toString() : "granted");
        return r;
    }

    @PluginMethod public void requestScanPermissions(PluginCall call) {
        boolean need = false;
        for (String a : aliases()) if (getPermissionState(a) != PermissionState.GRANTED) need = true;
        if (!need) { call.resolve(result()); return; }
        requestPermissionForAliases(aliases(), call, "permsCallback");
    }
    @PermissionCallback private void permsCallback(PluginCall call) { call.resolve(result()); }

    @PluginMethod public void start(PluginCall call) {
        String mode = call.getString("mode", "balanced");
        boolean filtered = call.getBoolean("filtered", true);
        int[] cids = new int[0]; String[] uuids = new String[0]; String[] ouis = new String[0];
        JSArray wr = call.getArray("wifiRules", null);
        String wifiRules = wr == null ? null : wr.toString();
        try {
            JSArray c = call.getArray("companyIds", new JSArray());
            cids = new int[c.length()]; for (int i = 0; i < c.length(); i++) cids[i] = c.getInt(i);
            JSArray u = call.getArray("serviceUuids", new JSArray());
            uuids = new String[u.length()]; for (int i = 0; i < u.length(); i++) uuids[i] = u.getString(i);
            JSArray o = call.getArray("ouis", new JSArray());
            ouis = new String[o.length()]; for (int i = 0; i < o.length(); i++) ouis[i] = o.getString(i).toUpperCase();
        } catch (Exception e) { call.reject("bad filters"); return; }
        android.bluetooth.BluetoothManager bm = (android.bluetooth.BluetoothManager) getContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        android.bluetooth.BluetoothAdapter ad = bm == null ? null : bm.getAdapter();
        if (ad == null) { call.reject("This phone has no Bluetooth LE adapter."); return; }
        if (!ad.isEnabled()) { call.reject("Bluetooth is off. Turn on Bluetooth, then tap Start again."); return; }
        // Keep native background alerts consistent with the app's sound preference.
        getContext().getSharedPreferences("patrol_alerts", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("sound", call.getBoolean("alertSound", true)).apply();
        try { ScanService.start(getContext(), mode, filtered, cids, uuids, wifiRules, ouis); call.resolve(); }
        catch (Exception e) { call.reject("Could not start background scan: " + e.getMessage()); }
    }
    /** Saved appearance choice. Light and Dark stick; anything else follows the phone. */
    @PluginMethod public void setThemeBars(PluginCall call) {
        String choice = call.getString("choice", "system");
        if (!"light".equals(choice) && !"dark".equals(choice)) choice = "system";
        SystemBars.saveChoice(getContext(), choice);
        android.app.Activity activity = getActivity();
        if (activity != null) {
            String saved = choice;
            activity.runOnUiThread(() -> SystemBars.paint(activity, SystemBars.light(activity, saved)));
        }
        call.resolve();
    }
    @PluginMethod public void setAlertSound(PluginCall call) {
        getContext().getSharedPreferences("patrol_alerts", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("sound", call.getBoolean("enabled", true)).apply();
        call.resolve();
    }
    @PluginMethod public void stop(PluginCall call) { ScanService.stop(getContext()); call.resolve(); }
    @PluginMethod public void status(PluginCall call) { JSObject r = result(); r.put("running", ScanService.running); r.put("sessionActive", ScanService.sessionActive); r.put("stopReason", ScanService.stopReason); call.resolve(r); }

    /** Read-only setup information; opening this screen never requests permissions. */
    @PluginMethod public void setupStatus(PluginCall call) {
        JSObject r = result();
        android.bluetooth.BluetoothManager bm = (android.bluetooth.BluetoothManager) getContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        android.bluetooth.BluetoothAdapter adapter = bm == null ? null : bm.getAdapter();
        try { r.put("bluetooth", adapter == null ? "unavailable" : adapter.isEnabled() ? "on" : "off"); }
        catch (SecurityException e) { r.put("bluetooth", "unknown"); }
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        if (pm != null) r.put("batteryExempt", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (nm != null) r.put("notificationsEnabled", androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(r);
    }

    /**
     * Whether this process may honor client-side Pro flags. Read-only; does not start or stop scanning.
     * debuggable is the installed package flag (debug APKs are debuggable; Play releases are not).
     * installer is the installing package, com.android.vending for every Play track.
     */
    @PluginMethod @SuppressWarnings("deprecation") public void distribution(PluginCall call) {
        android.content.pm.ApplicationInfo app = getContext().getApplicationInfo();
        boolean debuggable = (app.flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        String installer = null;
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            if (Build.VERSION.SDK_INT >= 30) installer = pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            else installer = pm.getInstallerPackageName(pkg);
        } catch (Exception ignored) { /* unknown installer: client flags stay off */ }
        JSObject r = new JSObject();
        r.put("debuggable", debuggable);
        r.put("installer", installer);
        call.resolve(r);
    }

    /** Epoch millis of PackageInfo.firstInstallTime. Read-only; updates do not change it. Does not start or stop scanning. */
    @PluginMethod public void firstInstallTime(PluginCall call) {
        try {
            android.content.pm.PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            android.content.pm.PackageInfo info = Build.VERSION.SDK_INT >= 33
                ? pm.getPackageInfo(pkg, android.content.pm.PackageManager.PackageInfoFlags.of(0))
                : pm.getPackageInfo(pkg, 0);
            JSObject r = new JSObject();
            r.put("firstInstallTime", info.firstInstallTime);
            call.resolve(r);
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            call.reject("install time unavailable");
        }
    }

    /** Opens the system dialog to exempt the app from battery optimisation (user choice). */
    @PluginMethod public void openBatterySettings(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject r = new JSObject();
        boolean ignoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        r.put("ignoring", ignoring);
        if (!ignoring) {
            // Play policy: no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. Open the system list; the user picks the app.
            getContext().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve(r);
    }
    /** Optional JS notification bridge; native service uses the same channel helper. */
    @PluginMethod public void alert(PluginCall call) {
        boolean sent = PoliceAlertNotifications.show(getContext(),
            call.getString("title", "Police gear nearby"), call.getString("text", ""),
            call.getBoolean("soft", false), call.getBoolean("silent", false));
        if (sent) call.resolve(); else call.reject("notifications not allowed");
    }
}

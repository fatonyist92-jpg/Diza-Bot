package com.diza.ai;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String PREFS = "diza";
    private static final String KEY_SERVER = "server";
    private static final String DEFAULT_SERVER = "http://127.0.0.1:8799";

    private static final int BG = Color.rgb(11, 20, 26);
    private static final int SURFACE = Color.rgb(32, 44, 51);
    private static final int SURFACE_2 = Color.rgb(17, 27, 33);
    private static final int ACCENT = Color.rgb(0, 168, 132);
    private static final int USER_BUBBLE = Color.rgb(0, 92, 75);
    private static final int BOT_BUBBLE = Color.rgb(32, 44, 51);
    private static final int TEXT = Color.rgb(233, 237, 239);
    private static final int MUTED = Color.rgb(134, 150, 160);
    private static final int DIVIDER = Color.rgb(38, 52, 60);

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private FrameLayout root;
    private JSONArray bots = new JSONArray();
    private JSONArray rooms = new JSONArray();
    private boolean agentsTab = true;
    private String searchText = "";
    private String serverUrl;

    private String openThreadId;
    private String openThreadName;
    private boolean openThreadRoom;
    private int renderedMessageCount = -1;
    private ScrollView chatScroll;
    private LinearLayout messageList;

    private final Runnable chatPoll = new Runnable() {
        @Override public void run() {
            if (openThreadId == null) return;
            loadOpenThread(false);
            main.postDelayed(this, 1200);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(SURFACE);
        getWindow().setNavigationBarColor(BG);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);

        serverUrl = normalizeServer(
                getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SERVER, DEFAULT_SERVER)
        );
        if (serverUrl == null) serverUrl = DEFAULT_SERVER;

        showHome();
        loadHome(true);
    }

    private void showHome() {
        stopPolling();
        openThreadId = null;
        root.removeAllViews();

        LinearLayout page = vertical(BG);
        root.addView(page, match());

        LinearLayout top = horizontal(SURFACE);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(16), dp(14), dp(8), dp(10));
        page.addView(top, lp(-1, -2));

        LinearLayout titleBox = vertical(Color.TRANSPARENT);
        TextView title = text("Diza", 23, TEXT, true);
        TextView subtitle = text("Obrolan", 12, MUTED, false);
        titleBox.addView(title);
        titleBox.addView(subtitle);
        top.addView(titleBox, new LinearLayout.LayoutParams(0, -2, 1));

        TextView add = iconButton("＋");
        add.setContentDescription("Tambah");
        add.setOnClickListener(v -> {
            if (agentsTab) showCreateAgent();
            else showCreateRoomName();
        });
        top.addView(add, lp(dp(44), dp(44)));

        TextView settings = iconButton("⚙");
        settings.setContentDescription("Pengaturan");
        settings.setOnClickListener(v -> showSettings());
        top.addView(settings, lp(dp(44), dp(44)));

        EditText search = new EditText(this);
        search.setSingleLine(true);
        search.setHint("Cari");
        search.setTextColor(TEXT);
        search.setHintTextColor(MUTED);
        search.setTextSize(15);
        search.setPadding(dp(16), 0, dp(16), 0);
        search.setBackground(round(SURFACE_2, dp(24)));
        search.setText(searchText);
        LinearLayout.LayoutParams searchLp = lp(-1, dp(46));
        searchLp.setMargins(dp(12), dp(8), dp(12), dp(8));
        page.addView(search, searchLp);
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                searchText = s.toString();
                renderHomeList();
            }
            public void afterTextChanged(Editable s) {}
        });

        LinearLayout tabs = horizontal(SURFACE);
        page.addView(tabs, lp(-1, dp(46)));
        TextView agents = tab("Agents", agentsTab);
        TextView roomsTab = tab("Rooms", !agentsTab);
        tabs.addView(agents, new LinearLayout.LayoutParams(0, -1, 1));
        tabs.addView(roomsTab, new LinearLayout.LayoutParams(0, -1, 1));
        agents.setOnClickListener(v -> {
            agentsTab = true;
            showHome();
            renderHomeList();
        });
        roomsTab.setOnClickListener(v -> {
            agentsTab = false;
            showHome();
            renderHomeList();
        });

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setTag("home-scroll");
        LinearLayout list = vertical(BG);
        list.setTag("home-list");
        scroll.addView(list, match());
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        renderHomeList();
    }

    private void renderHomeList() {
        LinearLayout list = root.findViewWithTag("home-list");
        if (list == null) return;
        list.removeAllViews();

        JSONArray source = agentsTab ? bots : rooms;
        String needle = searchText.trim().toLowerCase(Locale.ROOT);
        int visible = 0;

        for (int i = 0; i < source.length(); i++) {
            JSONObject item = source.optJSONObject(i);
            if (item == null) continue;
            if (agentsTab && (item.optBoolean("hidden") || item.has("archivedAt") && !item.isNull("archivedAt"))) continue;

            String name = item.optString("name", agentsTab ? "Agent" : "Room");
            JSONObject last = lastMessage(item.optJSONArray("messages"));
            String preview = messageText(last);
            String hay = (name + " " + item.optString("title") + " " + preview).toLowerCase(Locale.ROOT);
            if (!needle.isEmpty() && !hay.contains(needle)) continue;

            visible++;
            LinearLayout row = horizontal(BG);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(14), dp(11), dp(12), dp(8));
            row.setClickable(true);
            row.setBackground(selectable(BG));

            TextView avatar = avatar(name, agentsTab ? ACCENT : Color.rgb(83, 101, 111));
            row.addView(avatar, lp(dp(52), dp(52)));

            LinearLayout body = vertical(Color.TRANSPARENT);
            LinearLayout.LayoutParams bodyLp = new LinearLayout.LayoutParams(0, -2, 1);
            bodyLp.setMargins(dp(12), 0, 0, 0);
            row.addView(body, bodyLp);

            LinearLayout nameLine = horizontal(Color.TRANSPARENT);
            nameLine.setGravity(Gravity.CENTER_VERTICAL);
            TextView n = text(name, 16, TEXT, true);
            nameLine.addView(n, new LinearLayout.LayoutParams(0, -2, 1));
            long at = last != null ? last.optLong("at", 0) : 0;
            if (at > 0) nameLine.addView(text(formatWhen(at), 11, MUTED, false));
            body.addView(nameLine);

            LinearLayout previewLine = horizontal(Color.TRANSPARENT);
            previewLine.setGravity(Gravity.CENTER_VERTICAL);
            TextView p = text(preview.isEmpty() ? "Belum ada pesan" : preview, 13, MUTED, false);
            p.setSingleLine(true);
            p.setEllipsize(android.text.TextUtils.TruncateAt.END);
            previewLine.addView(p, new LinearLayout.LayoutParams(0, -2, 1));
            if (agentsTab && item.optBoolean("unread")) {
                TextView dot = new TextView(this);
                dot.setBackground(round(ACCENT, dp(8)));
                LinearLayout.LayoutParams dotLp = lp(dp(10), dp(10));
                dotLp.setMargins(dp(8), 0, 0, 0);
                previewLine.addView(dot, dotLp);
            }
            body.addView(previewLine);

            View divider = new View(this);
            divider.setBackgroundColor(DIVIDER);
            LinearLayout.LayoutParams dlp = lp(-1, dp(1));
            dlp.setMargins(0, dp(11), 0, 0);
            body.addView(divider, dlp);

            String id = item.optString("id");
            boolean room = !agentsTab;
            row.setOnClickListener(v -> showChat(id, name, room));
            list.addView(row, lp(-1, -2));
        }

        if (visible == 0) {
            TextView empty = text(
                    searchText.trim().isEmpty() ? (agentsTab ? "Belum ada agent" : "Belum ada room") : "Tidak ditemukan",
                    14, MUTED, false
            );
            empty.setGravity(Gravity.CENTER);
            list.addView(empty, lp(-1, dp(240)));
        }
    }

    private void loadHome(boolean showError) {
        io.execute(() -> {
            try {
                JSONObject b = requestJson("GET", "/api/bots?messages=1", null);
                JSONObject r = requestJson("GET", "/api/bloks", null);
                bots = b.optJSONArray("bots") != null ? b.optJSONArray("bots") : new JSONArray();
                rooms = r.optJSONArray("bloks") != null ? r.optJSONArray("bloks") : new JSONArray();
                main.post(this::renderHomeList);
            } catch (Exception e) {
                if (showError) main.post(() -> showConnectionScreen(e.getMessage()));
            }
        });
    }

    private void showChat(String id, String name, boolean room) {
        stopPolling();
        openThreadId = id;
        openThreadName = name;
        openThreadRoom = room;
        renderedMessageCount = -1;
        root.removeAllViews();

        LinearLayout page = vertical(BG);
        root.addView(page, match());

        LinearLayout header = horizontal(SURFACE);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(4), dp(8), dp(8), dp(8));
        page.addView(header, lp(-1, dp(58)));

        TextView back = iconButton("‹");
        back.setTextSize(38);
        back.setOnClickListener(v -> {
            showHome();
            loadHome(false);
        });
        header.addView(back, lp(dp(46), dp(46)));

        TextView avatar = avatar(name, room ? Color.rgb(83, 101, 111) : ACCENT);
        header.addView(avatar, lp(dp(38), dp(38)));

        LinearLayout hText = vertical(Color.TRANSPARENT);
        LinearLayout.LayoutParams hTextLp = new LinearLayout.LayoutParams(0, -2, 1);
        hTextLp.setMargins(dp(10), 0, 0, 0);
        header.addView(hText, hTextLp);
        hText.addView(text(name, 16, TEXT, true));
        hText.addView(text(room ? "Room" : "Agent", 11, MUTED, false));

        chatScroll = new ScrollView(this);
        chatScroll.setFillViewport(true);
        messageList = vertical(BG);
        messageList.setPadding(dp(10), dp(10), dp(10), dp(10));
        chatScroll.addView(messageList, match());
        page.addView(chatScroll, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout composer = horizontal(SURFACE);
        composer.setGravity(Gravity.BOTTOM);
        composer.setPadding(dp(8), dp(7), dp(8), dp(7));
        page.addView(composer, lp(-1, -2));

        EditText input = new EditText(this);
        input.setHint("Pesan");
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setTextSize(15);
        input.setMaxLines(5);
        input.setImeOptions(EditorInfo.IME_ACTION_SEND);
        input.setPadding(dp(15), dp(10), dp(15), dp(10));
        input.setBackground(round(SURFACE_2, dp(24)));
        composer.addView(input, new LinearLayout.LayoutParams(0, -2, 1));

        TextView send = text("➤", 22, Color.WHITE, true);
        send.setGravity(Gravity.CENTER);
        send.setBackground(round(ACCENT, dp(24)));
        LinearLayout.LayoutParams sendLp = lp(dp(46), dp(46));
        sendLp.setMargins(dp(8), 0, 0, 0);
        composer.addView(send, sendLp);

        View.OnClickListener doSend = v -> sendMessage(input);
        send.setOnClickListener(doSend);
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) {
                sendMessage(input);
                return true;
            }
            return false;
        });

        loadOpenThread(true);
        main.postDelayed(chatPoll, 1200);
    }

    private void loadOpenThread(boolean forceScroll) {
        String id = openThreadId;
        boolean room = openThreadRoom;
        if (id == null) return;

        io.execute(() -> {
            try {
                JSONArray messages;
                if (room) {
                    JSONObject all = requestJson("GET", "/api/bloks", null);
                    JSONArray items = all.optJSONArray("bloks");
                    JSONObject found = findById(items, id);
                    messages = found != null ? found.optJSONArray("messages") : null;
                } else {
                    JSONObject all = requestJson("GET", "/api/bots?messages=120", null);
                    JSONArray items = all.optJSONArray("bots");
                    JSONObject found = findById(items, id);
                    messages = found != null ? found.optJSONArray("messages") : null;
                }
                if (messages == null) messages = new JSONArray();
                JSONArray finalMessages = messages;
                main.post(() -> renderMessages(finalMessages, forceScroll));
            } catch (Exception ignored) {}
        });
    }

    private void renderMessages(JSONArray messages, boolean forceScroll) {
        if (messageList == null || openThreadId == null) return;
        if (!forceScroll && renderedMessageCount == messages.length()) return;

        renderedMessageCount = messages.length();
        messageList.removeAllViews();

        for (int i = 0; i < messages.length(); i++) {
            JSONObject msg = messages.optJSONObject(i);
            if (msg == null || msg.optBoolean("deleted")) continue;
            boolean user = "user".equals(msg.optString("role"));
            String display = messageText(msg);
            if (display.isEmpty()) continue;

            LinearLayout row = horizontal(Color.TRANSPARENT);
            row.setGravity(user ? Gravity.END : Gravity.START);

            LinearLayout bubble = vertical(user ? USER_BUBBLE : BOT_BUBBLE);
            bubble.setPadding(dp(11), dp(8), dp(11), dp(7));
            bubble.setBackground(round(user ? USER_BUBBLE : BOT_BUBBLE, dp(12)));

            if (openThreadRoom && !user) {
                String who = roomAuthor(msg);
                if (!who.isEmpty()) bubble.addView(text(who, 11, ACCENT, true));
            }

            TextView body = text(display, 15, TEXT, false);
            body.setTextIsSelectable(true);
            bubble.addView(body);

            long at = msg.optLong("at", 0);
            if (at > 0) {
                TextView time = text(new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(at)), 10, MUTED, false);
                time.setGravity(Gravity.END);
                bubble.addView(time);
            }

            LinearLayout.LayoutParams bubbleLp = lp(-2, -2);
            bubbleLp.setMargins(user ? dp(52) : 0, dp(3), user ? 0 : dp(52), dp(3));
            row.addView(bubble, bubbleLp);
            messageList.addView(row, lp(-1, -2));
        }

        if (forceScroll || renderedMessageCount > 0) {
            chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
        }
    }

    private void sendMessage(EditText input) {
        String text = input.getText().toString().trim();
        String id = openThreadId;
        if (text.isEmpty() || id == null) return;
        input.setText("");

        JSONObject body = new JSONObject();
        try { body.put("text", text); } catch (Exception ignored) {}
        String path = openThreadRoom ? "/api/bloks/" + id + "/messages" : "/api/bots/" + id + "/messages";

        io.execute(() -> {
            try {
                requestJson("POST", path, body);
                main.post(() -> loadOpenThread(true));
            } catch (Exception e) {
                main.post(() -> Toast.makeText(this, cleanError(e.getMessage()), Toast.LENGTH_LONG).show());
            }
        });
    }

    private void showSettings() {
        stopPolling();
        root.removeAllViews();

        LinearLayout page = vertical(BG);
        root.addView(page, match());

        LinearLayout header = horizontal(SURFACE);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(4), dp(8), dp(12), dp(8));
        page.addView(header, lp(-1, dp(58)));

        TextView back = iconButton("‹");
        back.setTextSize(38);
        back.setOnClickListener(v -> {
            showHome();
            loadHome(false);
        });
        header.addView(back, lp(dp(46), dp(46)));
        header.addView(text("Pengaturan", 19, TEXT, true));

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = vertical(BG);
        content.setPadding(dp(14), dp(14), dp(14), dp(24));
        scroll.addView(content, match());
        page.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout codexCard = card();
        content.addView(codexCard, lp(-1, -2));
        codexCard.addView(text("ChatGPT via Codex", 17, TEXT, true));
        TextView codexState = text("Mengecek status…", 13, MUTED, false);
        LinearLayout.LayoutParams stateLp = lp(-1, -2);
        stateLp.topMargin = dp(5);
        codexCard.addView(codexState, stateLp);
        TextView note = text("Login tetap memakai akun ChatGPT melalui Codex. Tidak memakai API key.", 12, MUTED, false);
        LinearLayout.LayoutParams noteLp = lp(-1, -2);
        noteLp.topMargin = dp(6);
        codexCard.addView(note, noteLp);

        LinearLayout actions = horizontal(Color.TRANSPARENT);
        LinearLayout.LayoutParams actionsLp = lp(-1, -2);
        actionsLp.topMargin = dp(12);
        codexCard.addView(actions, actionsLp);

        Button copy = actionButton("Salin login ChatGPT");
        actions.addView(copy, new LinearLayout.LayoutParams(0, dp(46), 1));
        copy.setOnClickListener(v -> {
            copyText("codex login --device-auth");
            Toast.makeText(this, "codex login --device-auth disalin", Toast.LENGTH_SHORT).show();
        });

        Button termux = actionButton("Buka Termux");
        LinearLayout.LayoutParams termuxLp = new LinearLayout.LayoutParams(0, dp(46), 1);
        termuxLp.setMargins(dp(8), 0, 0, 0);
        actions.addView(termux, termuxLp);
        termux.setOnClickListener(v -> openTermux());

        Button refresh = actionButton("Cek ulang status");
        LinearLayout.LayoutParams refreshLp = lp(-1, dp(46));
        refreshLp.topMargin = dp(8);
        codexCard.addView(refresh, refreshLp);
        refresh.setOnClickListener(v -> loadCodexState(codexState));
        loadCodexState(codexState);

        LinearLayout serverCard = card();
        LinearLayout.LayoutParams serverCardLp = lp(-1, -2);
        serverCardLp.topMargin = dp(14);
        content.addView(serverCard, serverCardLp);
        serverCard.addView(text("Server Diza", 17, TEXT, true));
        TextView endpoint = text(serverUrl, 13, MUTED, false);
        LinearLayout.LayoutParams epLp = lp(-1, -2);
        epLp.topMargin = dp(6);
        serverCard.addView(endpoint, epLp);
        TextView serverNote = text("UI ini native di APK. Server hanya menjalankan core Bloks + Codex di belakang layar.", 12, MUTED, false);
        LinearLayout.LayoutParams snLp = lp(-1, -2);
        snLp.topMargin = dp(7);
        serverCard.addView(serverNote, snLp);

        Button change = actionButton("Ubah alamat server");
        LinearLayout.LayoutParams changeLp = lp(-1, dp(46));
        changeLp.topMargin = dp(12);
        serverCard.addView(change, changeLp);
        change.setOnClickListener(v -> promptServer());
    }

    private void loadCodexState(TextView view) {
        view.setText("Mengecek status…");
        io.execute(() -> {
            try {
                JSONObject data = requestJson("GET", "/api/providers", null);
                JSONArray providers = data.optJSONArray("providers");
                JSONObject codex = null;
                if (providers != null) {
                    for (int i = 0; i < providers.length(); i++) {
                        JSONObject p = providers.optJSONObject(i);
                        if (p != null && "codex".equals(p.optString("kind"))) {
                            codex = p;
                            break;
                        }
                    }
                }
                final JSONObject found = codex;
                main.post(() -> {
                    if (found == null) {
                        view.setText("Codex tidak ditemukan pada server.");
                    } else if (!found.optBoolean("connected")) {
                        view.setText("Codex belum terpasang.");
                    } else if (found.optBoolean("needsSignIn")) {
                        view.setText("Codex terpasang, akun ChatGPT belum login. Gunakan device code.");
                    } else {
                        view.setText("Terhubung ke ChatGPT melalui Codex ✓");
                        view.setTextColor(ACCENT);
                    }
                });
            } catch (Exception e) {
                main.post(() -> view.setText("Server tidak dapat dicek."));
            }
        });
    }

    private void showCreateAgent() {
        final EditText input = dialogInput("Nama agent");
        new AlertDialog.Builder(this)
                .setTitle("Agent baru")
                .setView(input)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Buat", (d, which) -> {
                    String name = input.getText().toString().trim();
                    if (name.isEmpty()) name = "Agent";
                    JSONObject body = new JSONObject();
                    try { body.put("name", name); } catch (Exception ignored) {}
                    io.execute(() -> {
                        try {
                            requestJson("POST", "/api/bots", body);
                            main.post(() -> loadHome(false));
                        } catch (Exception e) {
                            main.post(() -> toastError(e));
                        }
                    });
                })
                .show();
    }

    private void showCreateRoomName() {
        final EditText input = dialogInput("Nama room");
        new AlertDialog.Builder(this)
                .setTitle("Room baru")
                .setView(input)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Lanjut", (d, which) -> {
                    String name = input.getText().toString().trim();
                    if (name.isEmpty()) name = "Room";
                    showRoomMembers(name);
                })
                .show();
    }

    private void showRoomMembers(String roomName) {
        List<JSONObject> available = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (int i = 0; i < bots.length(); i++) {
            JSONObject b = bots.optJSONObject(i);
            if (b == null || b.optBoolean("hidden")) continue;
            available.add(b);
            labels.add(b.optString("name", "Agent"));
        }
        if (available.size() < 2) {
            Toast.makeText(this, "Room butuh minimal 2 agent.", Toast.LENGTH_LONG).show();
            return;
        }

        boolean[] picked = new boolean[available.size()];
        new AlertDialog.Builder(this)
                .setTitle("Pilih minimal 2 agent")
                .setMultiChoiceItems(labels.toArray(new String[0]), picked, (d, which, yes) -> picked[which] = yes)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Buat", (d, which) -> {
                    JSONArray ids = new JSONArray();
                    for (int i = 0; i < picked.length; i++) if (picked[i]) ids.put(available.get(i).optString("id"));
                    if (ids.length() < 2) {
                        Toast.makeText(this, "Pilih minimal 2 agent.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    JSONObject body = new JSONObject();
                    try {
                        body.put("name", roomName);
                        body.put("memberIds", ids);
                    } catch (Exception ignored) {}
                    io.execute(() -> {
                        try {
                            requestJson("POST", "/api/bloks", body);
                            main.post(() -> {
                                agentsTab = false;
                                showHome();
                                loadHome(false);
                            });
                        } catch (Exception e) {
                            main.post(() -> toastError(e));
                        }
                    });
                })
                .show();
    }

    private void showConnectionScreen(String reason) {
        stopPolling();
        root.removeAllViews();

        LinearLayout page = vertical(BG);
        page.setGravity(Gravity.CENTER);
        page.setPadding(dp(28), dp(36), dp(28), dp(36));
        root.addView(page, match());

        TextView title = text("Diza", 32, TEXT, true);
        title.setGravity(Gravity.CENTER);
        page.addView(title);

        TextView msg = text(
                "Core Diza belum terhubung. UI tetap berjalan native di APK.\n\nJalankan server Bloks di perangkat ini, lalu login ChatGPT lewat Codex Device Auth.",
                14, MUTED, false
        );
        msg.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams msgLp = lp(-1, -2);
        msgLp.setMargins(0, dp(12), 0, dp(18));
        page.addView(msg, msgLp);

        EditText endpoint = new EditText(this);
        endpoint.setSingleLine(true);
        endpoint.setText(serverUrl);
        endpoint.setTextColor(TEXT);
        endpoint.setHintTextColor(MUTED);
        endpoint.setTextSize(14);
        endpoint.setPadding(dp(14), 0, dp(14), 0);
        endpoint.setBackground(round(SURFACE, dp(12)));
        page.addView(endpoint, lp(-1, dp(52)));

        Button connect = actionButton("Hubungkan");
        LinearLayout.LayoutParams connectLp = lp(-1, dp(50));
        connectLp.topMargin = dp(12);
        page.addView(connect, connectLp);
        connect.setOnClickListener(v -> {
            String normalized = normalizeServer(endpoint.getText().toString());
            if (normalized == null) {
                endpoint.setError("Gunakan localhost HTTP atau alamat HTTPS.");
                return;
            }
            saveServer(normalized);
            showHome();
            loadHome(true);
        });

        Button copy = actionButton("Salin perintah login ChatGPT");
        LinearLayout.LayoutParams copyLp = lp(-1, dp(50));
        copyLp.topMargin = dp(8);
        page.addView(copy, copyLp);
        copy.setOnClickListener(v -> {
            copyText("codex login --device-auth");
            Toast.makeText(this, "codex login --device-auth disalin", Toast.LENGTH_SHORT).show();
        });

        if (reason != null && !reason.isEmpty()) {
            TextView err = text(cleanError(reason), 11, Color.rgb(238, 112, 112), false);
            err.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams errLp = lp(-1, -2);
            errLp.topMargin = dp(14);
            page.addView(err, errLp);
        }
    }

    private void promptServer() {
        final EditText input = dialogInput("Alamat server");
        input.setText(serverUrl);
        new AlertDialog.Builder(this)
                .setTitle("Server Diza")
                .setView(input)
                .setNegativeButton("Batal", null)
                .setPositiveButton("Simpan", (d, which) -> {
                    String value = normalizeServer(input.getText().toString());
                    if (value == null) {
                        Toast.makeText(this, "Alamat server tidak valid.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    saveServer(value);
                    showSettings();
                })
                .show();
    }

    private JSONObject requestJson(String method, String path, JSONObject body) throws Exception {
        URL url = new URL(serverUrl + path);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(20000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setUseCaches(false);

        if (body != null) {
            connection.setDoOutput(true);
            byte[] bytes = body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
        }

        int code = connection.getResponseCode();
        InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String response = readAll(stream);
        connection.disconnect();

        if (code >= 400) {
            String message = response;
            try {
                JSONObject error = new JSONObject(response);
                message = error.optString("error", response);
            } catch (Exception ignored) {}
            throw new Exception(message.isEmpty() ? ("HTTP " + code) : message);
        }
        return response.isEmpty() ? new JSONObject() : new JSONObject(response);
    }

    private String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }

    private JSONObject findById(JSONArray items, String id) {
        if (items == null) return null;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && id.equals(item.optString("id"))) return item;
        }
        return null;
    }

    private JSONObject lastMessage(JSONArray messages) {
        return messages != null && messages.length() > 0 ? messages.optJSONObject(messages.length() - 1) : null;
    }

    private String messageText(JSONObject msg) {
        if (msg == null) return "";
        String kind = msg.optString("kind", "text");
        String text = msg.optString("text", "").trim();
        if (!text.isEmpty()) return text;

        JSONObject card = msg.optJSONObject("card");
        if (card != null) {
            String title = card.optString("title", "").trim();
            if (!title.isEmpty()) return title;
        }

        JSONObject artifact = msg.optJSONObject("artifact");
        if (artifact != null) return "File: " + artifact.optString("name", "artifact");
        JSONObject connector = msg.optJSONObject("connector");
        if (connector != null) return "Hubungkan " + connector.optString("label", "app");
        JSONObject imagine = msg.optJSONObject("imagine");
        if (imagine != null) return "DIZA Imagine: " + imagine.optString("operation", "media");

        if ("activity".equals(kind)) return "Sedang bekerja…";
        if ("screen".equals(kind)) return "Membagikan tampilan";
        if ("options".equals(kind)) return "Meminta pilihan";
        return kind.isEmpty() ? "" : "[" + kind + "]";
    }

    private String roomAuthor(JSONObject msg) {
        String botId = msg.optString("botId", "");
        if (botId.isEmpty()) return "";
        JSONObject bot = findById(bots, botId);
        return bot != null ? bot.optString("name", "") : "";
    }

    private String formatWhen(long at) {
        Date when = new Date(at);
        Date now = new Date();
        SimpleDateFormat day = new SimpleDateFormat("yyyyMMdd", Locale.getDefault());
        if (day.format(when).equals(day.format(now))) {
            return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(when);
        }
        long age = System.currentTimeMillis() - at;
        if (age < 2L * 24 * 60 * 60 * 1000) return "Kemarin";
        if (age < 7L * 24 * 60 * 60 * 1000) return new SimpleDateFormat("EEE", Locale.getDefault()).format(when);
        return new SimpleDateFormat("dd/MM", Locale.getDefault()).format(when);
    }

    private LinearLayout card() {
        LinearLayout card = vertical(SURFACE_2);
        card.setPadding(dp(16), dp(16), dp(16), dp(16));
        card.setBackground(round(SURFACE_2, dp(14)));
        return card;
    }

    private TextView tab(String label, boolean active) {
        TextView view = text(label, 14, active ? ACCENT : MUTED, true);
        view.setGravity(Gravity.CENTER);
        if (active) {
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(SURFACE);
            bg.setStroke(dp(0), ACCENT);
            view.setBackground(bg);
        }
        return view;
    }

    private TextView avatar(String name, int color) {
        String initial = name == null || name.trim().isEmpty() ? "D" : name.trim().substring(0, 1).toUpperCase(Locale.ROOT);
        TextView v = text(initial, 19, Color.WHITE, true);
        v.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        v.setBackground(bg);
        return v;
    }

    private TextView iconButton(String glyph) {
        TextView v = text(glyph, 24, TEXT, false);
        v.setGravity(Gravity.CENTER);
        v.setBackground(selectable(SURFACE));
        return v;
    }

    private Button actionButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(TEXT);
        b.setTextSize(13);
        b.setBackground(round(SURFACE, dp(10)));
        return b;
    }

    private EditText dialogInput(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setPadding(dp(20), 0, dp(20), 0);
        return input;
    }

    private LinearLayout vertical(int color) {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setBackgroundColor(color);
        return v;
    }

    private LinearLayout horizontal(int color) {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.HORIZONTAL);
        v.setBackgroundColor(color);
        return v;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sp);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private GradientDrawable selectable(int color) {
        GradientDrawable drawable = round(color, dp(10));
        return drawable;
    }

    private FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(-1, -1);
    }

    private LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void copyText(String value) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Diza", value));
    }

    private void openTermux() {
        Intent intent = getPackageManager().getLaunchIntentForPackage("com.termux");
        if (intent != null) {
            startActivity(intent);
        } else {
            copyText("codex login --device-auth");
            Toast.makeText(this, "Termux tidak ditemukan. Perintah login ChatGPT sudah disalin.", Toast.LENGTH_LONG).show();
        }
    }

    private void saveServer(String value) {
        serverUrl = value;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, value).apply();
    }

    private String normalizeServer(String raw) {
        if (raw == null) return null;
        String text = raw.trim().replaceAll("/+$", "");
        if (text.isEmpty()) return null;
        Uri uri = Uri.parse(text);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return null;
        boolean localhost = "127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host);
        if (localhost && "http".equalsIgnoreCase(scheme)) return text;
        if ("https".equalsIgnoreCase(scheme)) return text;
        return null;
    }

    private String cleanError(String value) {
        if (value == null) return "Tidak dapat terhubung.";
        String clean = value.replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
        return clean.length() > 180 ? clean.substring(0, 180) + "…" : clean;
    }

    private void toastError(Exception e) {
        Toast.makeText(this, cleanError(e.getMessage()), Toast.LENGTH_LONG).show();
    }

    private void stopPolling() {
        main.removeCallbacks(chatPoll);
    }

    @Override
    public void onBackPressed() {
        if (openThreadId != null) {
            showHome();
            loadHome(false);
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopPolling();
        io.shutdownNow();
        super.onDestroy();
    }
}

import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/agent.dart';
import '../models/chat_message.dart';
import '../models/ticket.dart';
import '../services/api_service.dart';
import 'package:hats_avatar_view/hats_avatar_view.dart';
import '../services/auth_service.dart';

class AppState extends ChangeNotifier {
  final AuthService _auth = AuthService();

  String? serverUrl;
  String? apiKey;
  String? username;
  String? projectId;

  List<Agent> agents = [];
  List<ChatMessage> messages = [];
  List<Ticket> tickets = [];

  ApiService? _api;
  StreamSubscription<Map<String, dynamic>>? _sseSub;

  /// Live avatar views, by agent name.
  ///
  /// A card registers its face when it mounts so speech can be routed to the
  /// right one: the runner tells us who is speaking, not which widget.
  final Map<String, AvatarViewState> _avatarViews = {};

  void registerAvatarView(String agentName, AvatarViewState view) {
    _avatarViews[agentName.toLowerCase()] = view;
  }

  void unregisterAvatarView(String agentName) {
    _avatarViews.remove(agentName.toLowerCase());
  }

  /// The face for an agent, if one is on screen.
  AvatarViewState? avatarViewFor(String agentName) => _avatarViews[agentName.toLowerCase()];

  /// Drive one agent's lip sync. Silently does nothing when its card is not
  /// mounted, which is the common case on a small screen.
  Future<void> applyLipSync(String agentName, List<dynamic> visemes) async {
    await avatarViewFor(agentName)?.applyLipSync(visemes);
  }

  ApiService get api {
    assert(_api != null, 'ApiService not initialised — call initFromStorage first');
    return _api!;
  }

  bool get isAuthenticated => apiKey != null && serverUrl != null;
  bool get hasProject => projectId != null;

  Future<bool> initFromStorage() async {
    final creds = await _auth.load();
    if (creds == null) return false;
    serverUrl = creds.serverUrl;
    apiKey = creds.apiKey;
    username = creds.username;
    _api = ApiService(serverUrl: serverUrl!, apiKey: apiKey!);
    projectId = await _auth.loadProjectId();
    return true;
  }

  Future<void> setCredentials({
    required String url,
    required String key,
    required String user,
  }) async {
    serverUrl = url;
    apiKey = key;
    username = user;
    await _auth.save(serverUrl: url, apiKey: key, username: user);
    _api = ApiService(serverUrl: url, apiKey: key);
    notifyListeners();
  }

  Future<void> setProject(String id) async {
    projectId = id;
    await _auth.saveProjectId(id);
    final fetched = await _api!.switchProject(id);
    agents = fetched;
    messages = [];
    notifyListeners();
    _reconnectSse();
  }

  void _reconnectSse() {
    _sseSub?.cancel();
    _sseSub = _api!.connectSse().listen(_handleSseEvent, onError: (_) {
      // reconnect after a delay
      Future.delayed(const Duration(seconds: 5), _reconnectSse);
    });
  }

  void _handleSseEvent(Map<String, dynamic> event) {
    final type = event['type'] as String?;
    switch (type) {
      case 'init':
        final raw = event['agents'] as List<dynamic>?;
        if (raw != null) {
          agents = raw.map((j) => Agent.fromJson(j as Map<String, dynamic>)).toList();
        }
        final rawTickets = event['tickets'] as List<dynamic>?;
        if (rawTickets != null) {
          tickets = rawTickets
              .map((j) => Ticket.fromJson(j as Map<String, dynamic>))
              .toList();
        }
      case 'agent_update':
        final raw = event['agents'] as List<dynamic>?;
        if (raw != null) {
          agents = raw.map((j) => Agent.fromJson(j as Map<String, dynamic>)).toList();
        }
      case 'cli_output':
        if (event['kind'] == 'agent') {
          final from = event['from'] as String?;
          final content = event['content'] as String?;
          if (from != null && content != null && content.isNotEmpty) {
            messages = [
              ...messages,
              ChatMessage(text: content, sender: MessageSender.agent, agentName: from),
            ];
          }
        }
      case 'board_update':
        final board = event['board'] as Map<String, dynamic>?;
        if (board != null) {
          final raw = board['tickets'];
          if (raw is Map<String, dynamic>) {
            tickets = raw.values
                .map((j) => Ticket.fromJson(j as Map<String, dynamic>))
                .toList();
          }
        }
    }
    notifyListeners();
  }

  void addHumanMessage(String text, String agentName) {
    messages = [
      ...messages,
      ChatMessage(text: text, sender: MessageSender.human),
    ];
    notifyListeners();
    _api!.sendMessage(agentName, text).catchError((_) {});
  }

  Future<void> refreshTickets() async {
    try {
      tickets = await _api!.getTickets();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> logout() async {
    _sseSub?.cancel();
    _sseSub = null;
    await _api?.logout();
    await _auth.clear();
    serverUrl = null;
    apiKey = null;
    username = null;
    projectId = null;
    _api = null;
    agents = [];
    messages = [];
    tickets = [];
    notifyListeners();
  }

  @override
  void dispose() {
    _sseSub?.cancel();
    super.dispose();
  }
}

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  static const _store = FlutterSecureStorage();
  static const _keyServer = 'hats_server_url';
  static const _keyApiKey = 'hats_api_key';
  static const _keyUsername = 'hats_username';
  static const _keyProject = 'hats_project_id';

  Future<void> save({
    required String serverUrl,
    required String apiKey,
    required String username,
  }) async {
    await Future.wait([
      _store.write(key: _keyServer, value: serverUrl),
      _store.write(key: _keyApiKey, value: apiKey),
      _store.write(key: _keyUsername, value: username),
    ]);
  }

  Future<({String serverUrl, String apiKey, String username})?> load() async {
    final serverUrl = await _store.read(key: _keyServer);
    final apiKey = await _store.read(key: _keyApiKey);
    final username = await _store.read(key: _keyUsername);
    if (serverUrl == null || apiKey == null || username == null) return null;
    return (serverUrl: serverUrl, apiKey: apiKey, username: username);
  }

  Future<void> saveProjectId(String id) =>
      _store.write(key: _keyProject, value: id);

  Future<String?> loadProjectId() => _store.read(key: _keyProject);

  Future<void> clear() async {
    await Future.wait([
      _store.delete(key: _keyServer),
      _store.delete(key: _keyApiKey),
      _store.delete(key: _keyUsername),
      _store.delete(key: _keyProject),
    ]);
  }
}

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/agent.dart';
import '../models/project.dart';
import '../models/ticket.dart';

class ApiService {
  final String serverUrl;
  final String apiKey;

  ApiService({required this.serverUrl, required this.apiKey});

  Map<String, String> get _headers => {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      };

  Uri _uri(String path) => Uri.parse('$serverUrl$path');

  Future<List<Project>> getProjects() async {
    final r = await http.get(_uri('/api/projects'), headers: _headers);
    if (r.statusCode != 200) throw Exception('Failed to load projects');
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((j) => Project.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<Agent>> switchProject(String id) async {
    final r = await http.post(
      _uri('/api/project/switch'),
      headers: _headers,
      body: jsonEncode({'id': id}),
    );
    if (r.statusCode != 200) throw Exception('Failed to switch project');
    final data = jsonDecode(r.body) as Map<String, dynamic>;
    final agents = (data['agents'] as List<dynamic>?) ?? [];
    return agents.map((j) => Agent.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<List<Agent>> getAgents() async {
    final r = await http.get(_uri('/api/agents'), headers: _headers);
    if (r.statusCode != 200) throw Exception('Failed to load agents');
    final list = jsonDecode(r.body) as List<dynamic>;
    return list.map((j) => Agent.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<String> sendMessage(String agentName, String text) async {
    final r = await http.post(
      _uri('/api/cli'),
      headers: _headers,
      body: jsonEncode({'line': '@$agentName $text'}),
    );
    if (r.statusCode != 200) throw Exception('Failed to send message');
    final data = jsonDecode(r.body) as Map<String, dynamic>;
    return data['output'] as String? ?? '';
  }

  Future<List<Ticket>> getTickets() async {
    final r = await http.get(_uri('/api/kanban/tickets'), headers: _headers);
    if (r.statusCode != 200) throw Exception('Failed to load tickets');
    final data = jsonDecode(r.body) as Map<String, dynamic>;
    final tickets = (data['tickets'] as List<dynamic>?) ?? [];
    return tickets.map((j) => Ticket.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<void> logout() async {
    try {
      await http.post(_uri('/api/auth/logout'), headers: _headers);
    } catch (_) {}
  }

  /// Streams SSE events from /events as decoded JSON maps.
  Stream<Map<String, dynamic>> connectSse() async* {
    final request = http.Request('GET', _uri('/events'))
      ..headers.addAll({'X-Api-Key': apiKey, 'Accept': 'text/event-stream'});

    final client = http.Client();
    try {
      final response = await client.send(request);
      final lines = response.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter());

      final buffer = StringBuffer();
      await for (final line in lines) {
        if (line.startsWith('data:')) {
          buffer.write(line.substring(5).trim());
        } else if (line.isEmpty && buffer.isNotEmpty) {
          try {
            yield jsonDecode(buffer.toString()) as Map<String, dynamic>;
          } catch (_) {}
          buffer.clear();
        }
      }
    } finally {
      client.close();
    }
  }

  /// Redeems a QR pairing URL and returns the pair data.
  static Future<Map<String, dynamic>> redeemPairUrl(String pairUrl) async {
    final r = await http.get(Uri.parse(pairUrl));
    if (r.statusCode == 410) {
      throw Exception('Pairing link has expired');
    }
    if (r.statusCode == 404) {
      throw Exception('User not found');
    }
    if (r.statusCode != 200) {
      throw Exception('Pairing failed (${r.statusCode})');
    }
    return jsonDecode(r.body) as Map<String, dynamic>;
  }
}

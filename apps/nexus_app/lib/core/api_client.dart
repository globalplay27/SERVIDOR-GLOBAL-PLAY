import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class NexusApiException implements Exception {
  final String message;
  final int? statusCode;

  const NexusApiException(this.message, [this.statusCode]);

  @override
  String toString() => message;
}

class NexusLoginResult {
  final bool isMaster;
  final Map<String, dynamic>? client;

  const NexusLoginResult.master()
      : isMaster = true,
        client = null;

  const NexusLoginResult.client(this.client) : isMaster = false;
}

class NexusApiClient {
  static const baseUrl = 'https://servidor-nexus.diamantehinode2015.workers.dev';
  static const _tokenKey = 'nexus_session_token';
  static const _masterTokenKey = 'nexus_master_session_token';
  static const _roleKey = 'nexus_login_role';

  final http.Client _http;
  final FlutterSecureStorage _storage;
  String? _token;
  String? _masterToken;
  String? _savedRole;

  NexusApiClient({
    http.Client? httpClient,
    FlutterSecureStorage? storage,
  })  : _http = httpClient ?? http.Client(),
        _storage = storage ?? const FlutterSecureStorage();

  Future<void> restoreToken() async {
    _token = await _storage.read(key: _tokenKey);
    _masterToken = await _storage.read(key: _masterTokenKey);
    _savedRole = await _storage.read(key: _roleKey);
  }

  bool get hasToken => (_token ?? '').isNotEmpty;
  bool get hasMasterToken => (_masterToken ?? '').isNotEmpty;
  String? get savedRole => _savedRole;

  Map<String, String> _headers({bool jsonBody = false}) {
    final headers = <String, String>{
      'accept': 'application/json',
    };
    if (jsonBody) {
      headers['content-type'] = 'application/json';
    }
    if ((_token ?? '').isNotEmpty) {
      headers['x-nexus-session'] = _token!;
    }
    return headers;
  }

  dynamic _decode(http.Response response) {
    dynamic payload;
    try {
      payload = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    } catch (_) {
      payload = <String, dynamic>{'message': response.body};
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = payload is Map
          ? (payload['message'] ?? payload['error'] ?? 'Erro no servidor').toString()
          : 'Erro no servidor';
      throw NexusApiException(message, response.statusCode);
    }
    return payload;
  }

  Future<NexusLoginResult> loginUnified(String username, String password) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: {'accept': 'application/json', 'content-type': 'application/json'},
      body: jsonEncode({'username': username.trim(), 'password': password}),
    );
    final payload = _decode(response);
    if (payload is! Map) {
      throw const NexusApiException('Resposta de login inválida.');
    }

    final role = (payload['role'] ?? '').toString();
    final token = (payload['token'] ?? '').toString();
    if (token.isEmpty || (role != 'master' && role != 'client')) {
      throw const NexusApiException('Sessão não recebida do servidor.');
    }

    if (role == 'master') {
      _token = null;
      _masterToken = token;
      _savedRole = 'master';
      await _storage.delete(key: _tokenKey);
      await _storage.write(key: _masterTokenKey, value: token);
      await _storage.write(key: _roleKey, value: 'master');
      return const NexusLoginResult.master();
    }

    _masterToken = null;
    _token = token;
    _savedRole = 'client';
    await _storage.delete(key: _masterTokenKey);
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _roleKey, value: 'client');

    try {
      final clientData = await session();
      return NexusLoginResult.client(clientData);
    } catch (_) {
      _token = null;
      _savedRole = null;
      await _storage.delete(key: _tokenKey);
      await _storage.delete(key: _roleKey);
      rethrow;
    }
  }

  Future<Map<String, dynamic>> login(String username, String password) async {
    final result = await loginUnified(username, password);
    if (result.isMaster || result.client == null) {
      throw const NexusApiException('Esta credencial pertence ao Master.');
    }
    return result.client!;
  }


  Map<String, String> _masterHeaders({bool jsonBody = false}) {
    final headers = <String, String>{'accept': 'application/json'};
    if (jsonBody) headers['content-type'] = 'application/json';
    if ((_masterToken ?? '').isNotEmpty) {
      headers['cookie'] = 'nexus_master=${Uri.encodeComponent(_masterToken!)}';
    }
    return headers;
  }

  Future<Map<String, dynamic>> loginMaster(String username, String password) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/master/desktop-login'),
      headers: {'accept': 'application/json', 'content-type': 'application/json'},
      body: jsonEncode({'username': username.trim(), 'password': password}),
    );
    final payload = _decode(response);
    if (payload is! Map) {
      throw const NexusApiException('Resposta de login do Master inválida.');
    }
    final token = (payload['token'] ?? '').toString();
    if (token.isEmpty) {
      throw const NexusApiException('Sessão do Master não recebida.');
    }
    _masterToken = token;
    _savedRole = 'master';
    await _storage.write(key: _masterTokenKey, value: token);
    await _storage.write(key: _roleKey, value: 'master');
    return Map<String, dynamic>.from(payload);
  }

  Future<Map<String, dynamic>> masterStatus() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/system/status'),
      headers: _masterHeaders(),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<List<dynamic>> masterClients() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/clients'),
      headers: _masterHeaders(),
    );
    final payload = _decode(response);
    return payload is List ? List<dynamic>.from(payload) : const [];
  }

  Future<void> logoutMaster() async {
    try {
      await _http.post(
        Uri.parse('$baseUrl/master-logout'),
        headers: _masterHeaders(),
      );
    } catch (_) {}
    _masterToken = null;
    _savedRole = null;
    await _storage.delete(key: _masterTokenKey);
    await _storage.delete(key: _roleKey);
  }

  Future<Map<String, dynamic>> session() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/session'),
      headers: _headers(),
    );
    final payload = _decode(response);
    if (payload is! Map) {
      throw const NexusApiException('Sessão inválida.');
    }
    return Map<String, dynamic>.from(payload);
  }

  Future<Map<String, dynamic>> liveStatus() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/live-status'),
      headers: _headers(),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<List<dynamic>> connections() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/connections'),
      headers: _headers(),
    );
    final payload = _decode(response);
    if (payload is! Map) return const [];

    final value = payload['connections'];
    if (value is List) {
      return List<dynamic>.from(value);
    }
    if (value is Map) {
      return value.entries.map((entry) {
        final details = entry.value;
        if (details is Map) {
          return <String, dynamic>{
            'provider': entry.key.toString(),
            ...Map<String, dynamic>.from(details),
          };
        }
        return <String, dynamic>{
          'provider': entry.key.toString(),
          'connected': details == true,
        };
      }).toList(growable: false);
    }
    return const [];
  }

  Future<Uri> startInstagramConnection() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/instagram/start'),
      headers: _headers(),
    );
    final payload = _decode(response);
    final url = payload is Map ? (payload['url'] ?? '').toString() : '';
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme) {
      throw const NexusApiException('Link do Instagram não foi recebido.');
    }
    return uri;
  }

  Future<Map<String, dynamic>> videos() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/videos'),
      headers: _headers(),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> updateVideo(String jobId, Map<String, dynamic> patch) async {
    final response = await _http.patch(
      Uri.parse('$baseUrl/api/portal/videos/${Uri.encodeComponent(jobId)}'),
      headers: _headers(jsonBody: true),
      body: jsonEncode(patch),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<void> deleteVideo(String jobId) async {
    final response = await _http.delete(
      Uri.parse('$baseUrl/api/portal/videos/${Uri.encodeComponent(jobId)}'),
      headers: _headers(),
    );
    _decode(response);
  }

  Future<List<dynamic>> posts() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/posts'),
      headers: _headers(),
    );
    final payload = _decode(response);
    if (payload is Map && payload['posts'] is List) {
      return List<dynamic>.from(payload['posts'] as List);
    }
    return const [];
  }

  Future<Map<String, dynamic>> decidePost(String postId, String decision) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/portal/posts/${Uri.encodeComponent(postId)}/decision'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'decision': decision}),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> publishPostNow(String postId) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/portal/posts/${Uri.encodeComponent(postId)}/manual'),
      headers: _headers(jsonBody: true),
      body: '{}',
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> saveAgentProfile(Map<String, dynamic> data) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/portal/agent-profile'),
      headers: _headers(jsonBody: true),
      body: jsonEncode(data),
    );
    final payload = _decode(response);
    return payload is Map ? Map<String, dynamic>.from(payload) : <String, dynamic>{};
  }

  Future<List<dynamic>> supportTickets() async {
    final response = await _http.get(
      Uri.parse('$baseUrl/api/portal/support'),
      headers: _headers(),
    );
    final payload = _decode(response);
    if (payload is Map && payload['tickets'] is List) {
      return List<dynamic>.from(payload['tickets'] as List);
    }
    return const [];
  }

  Future<void> createSupportTicket(String subject, String message) async {
    final response = await _http.post(
      Uri.parse('$baseUrl/api/portal/support'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'subject': subject, 'message': message}),
    );
    _decode(response);
  }

  Future<void> logout() async {
    try {
      await _http.post(
        Uri.parse('$baseUrl/api/portal/logout'),
        headers: _headers(jsonBody: true),
        body: '{}',
      );
    } catch (_) {
      // Clear local access even if the network is unavailable.
    }
    _token = null;
    if (_savedRole == 'client') _savedRole = null;
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _roleKey);
  }
}

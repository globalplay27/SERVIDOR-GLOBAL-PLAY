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

  String _friendlyError(dynamic payload, int statusCode) {
    final raw = payload is Map
        ? (payload['message'] ?? payload['error'] ?? 'Erro no servidor').toString()
        : 'Erro no servidor';
    const messages = <String, String>{
      'unauthorized': 'Sua sessão expirou. Entre novamente.',
      'too_many_login_attempts': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
      'r2_unavailable': 'A biblioteca de mídia está temporariamente indisponível.',
      'video_too_large': 'O vídeo ultrapassa o limite de 100 MB.',
      'video_part_too_large': 'Uma parte do vídeo ficou maior que o limite permitido.',
      'invalid_video_type': 'Formato não suportado. Use MP4, MOV, WEBM ou MKV.',
      'video_size_required': 'Não foi possível identificar o tamanho do vídeo.',
      'video_url_invalid': 'O link do vídeo é inválido.',
      'video_url_https_required': 'Use um link HTTPS para importar o vídeo.',
      'video_url_not_allowed': 'Esse endereço de vídeo não pode ser importado.',
      'video_source_too_many_redirects': 'O link redirecionou vezes demais.',
      'youtube_stream_resolve_failed': 'Não foi possível obter esse vídeo público agora.',
      'invalid_trailer_url': 'O trailer selecionado não possui um link válido.',
      'video_not_found': 'Esse vídeo não existe mais na biblioteca.',
      'video_source_missing': 'O arquivo original do vídeo não está disponível.',
      'cloudflare_media_source_too_large': 'O vídeo é grande demais para o processador atual do Cloudflare.',
      'cloudflare_media_unavailable': 'O processador de vídeo do Cloudflare não está disponível neste momento.',
      'video_clip_generation_failed': 'Não foi possível gerar cortes utilizáveis desse vídeo.',
      'clip_not_found': 'Esse corte não existe mais.',
      'clip_not_approved': 'Aprove o corte antes de publicar.',
      'clip_already_published': 'Esse corte já foi publicado.',
      'invalid_schedule': 'Escolha uma data e horário válidos.',
      'folder_not_found': 'A pasta selecionada não existe mais.',
      'folder_name_required': 'Informe o nome da pasta.',
      'default_folder_locked': 'A pasta Meus vídeos não pode ser alterada.',
    };
    if (messages.containsKey(raw)) return messages[raw]!;
    if (raw.startsWith('video_source_http_')) {
      return 'O servidor de origem recusou o download do vídeo.';
    }
    if (statusCode >= 500) {
      return 'O servidor está temporariamente indisponível. Tente novamente.';
    }
    return raw;
  }

  dynamic _decode(http.Response response) {
    dynamic payload;
    try {
      payload = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    } catch (_) {
      payload = <String, dynamic>{'message': response.body};
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw NexusApiException(
        _friendlyError(payload, response.statusCode),
        response.statusCode,
      );
    }
    return payload;
  }

  Uri absoluteUri(String value) {
    final raw = value.trim();
    final parsed = Uri.tryParse(raw);
    if (parsed != null && parsed.hasScheme) return parsed;
    return Uri.parse(baseUrl + (raw.startsWith('/') ? raw : '/' + raw));
  }

  Map<String, String> get mediaHeaders => _headers();

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
    if (payload is Map && payload['connections'] is List) {
      return List<dynamic>.from(payload['connections'] as List);
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

  Future<Map<String, dynamic>> searchTrailers(
    String query, {
    String type = 'movie',
  }) async {
    final uri = Uri.parse(baseUrl + '/api/portal/trailers/search').replace(
      queryParameters: {
        'q': query.trim(),
        'type': type == 'series' ? 'series' : 'movie',
      },
    );
    final response = await _http.get(uri, headers: _headers()).timeout(
      const Duration(seconds: 25),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> importVideoFromUrl(
    String url, {
    required Map<String, dynamic> settings,
  }) async {
    final response = await _http
        .post(
          Uri.parse(baseUrl + '/api/portal/videos/import'),
          headers: _headers(jsonBody: true),
          body: jsonEncode({...settings, 'url': url.trim()}),
        )
        .timeout(const Duration(seconds: 60));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> importTrailer(
    String trailerUrl, {
    required String title,
    Map<String, dynamic> settings = const {},
  }) async {
    final response = await _http
        .post(
          Uri.parse(baseUrl + '/api/portal/videos/import-trailer'),
          headers: _headers(jsonBody: true),
          body: jsonEncode({
            ...settings,
            'url': trailerUrl.trim(),
            'contentTitle': title.trim(),
          }),
        )
        .timeout(const Duration(seconds: 45));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> createVideoUpload({
    required String fileName,
    required int size,
    required String contentType,
  }) async {
    final response = await _http
        .post(
          Uri.parse(baseUrl + '/api/portal/video-uploads'),
          headers: _headers(jsonBody: true),
          body: jsonEncode({
            'fileName': fileName,
            'size': size,
            'contentType': contentType,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> uploadVideoPart({
    required String key,
    required String uploadId,
    required int partNumber,
    required List<int> bytes,
  }) async {
    final uri = Uri.parse(baseUrl + '/api/portal/video-uploads/part').replace(
      queryParameters: {
        'key': key,
        'uploadId': uploadId,
        'partNumber': partNumber.toString(),
      },
    );
    NexusApiException? lastError;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final response = await _http
            .put(
              uri,
              headers: {
                ..._headers(),
                'content-type': 'application/octet-stream',
              },
              body: bytes,
            )
            .timeout(const Duration(seconds: 90));
        final payload = _decode(response);
        return payload is Map
            ? Map<String, dynamic>.from(payload)
            : <String, dynamic>{};
      } on NexusApiException catch (error) {
        lastError = error;
        if ((error.statusCode ?? 400) < 500) rethrow;
      }
      await Future<void>.delayed(Duration(milliseconds: 500 * (attempt + 1)));
    }
    throw lastError ?? const NexusApiException('Falha ao enviar uma parte do vídeo.');
  }

  Future<Map<String, dynamic>> completeVideoUpload({
    required String key,
    required String uploadId,
    required List<Map<String, dynamic>> parts,
    required int size,
    required String fileName,
    required String contentType,
    required Map<String, dynamic> settings,
  }) async {
    final response = await _http
        .post(
          Uri.parse(baseUrl + '/api/portal/video-uploads/complete'),
          headers: _headers(jsonBody: true),
          body: jsonEncode({
            'key': key,
            'uploadId': uploadId,
            'parts': parts,
            'size': size,
            'fileName': fileName,
            'contentType': contentType,
            'settings': settings,
          }),
        )
        .timeout(const Duration(seconds: 60));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<void> abortVideoUpload({
    required String key,
    required String uploadId,
  }) async {
    final uri = Uri.parse(baseUrl + '/api/portal/video-uploads').replace(
      queryParameters: {'key': key, 'uploadId': uploadId},
    );
    try {
      final response = await _http
          .delete(uri, headers: _headers())
          .timeout(const Duration(seconds: 20));
      _decode(response);
    } catch (_) {}
  }

  Future<Map<String, dynamic>> processVideo(
    String jobId,
    Map<String, dynamic> settings,
  ) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/process';
    final response = await _http
        .post(
          Uri.parse(baseUrl + path),
          headers: _headers(jsonBody: true),
          body: jsonEncode(settings),
        )
        .timeout(const Duration(seconds: 45));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> setClipApproval(
    String jobId,
    String clipId,
    String status,
  ) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/clips/' +
        Uri.encodeComponent(clipId) +
        '/approval';
    final response = await _http.post(
      Uri.parse(baseUrl + path),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'status': status}),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> adjustClip(
    String jobId,
    String clipId,
    Map<String, dynamic> patch,
  ) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/clips/' +
        Uri.encodeComponent(clipId) +
        '/adjust';
    final response = await _http.post(
      Uri.parse(baseUrl + path),
      headers: _headers(jsonBody: true),
      body: jsonEncode(patch),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> selectClip(
    String jobId,
    String clipId,
    bool selected,
  ) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/clips/' +
        Uri.encodeComponent(clipId) +
        '/select';
    final response = await _http.post(
      Uri.parse(baseUrl + path),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'selected': selected}),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> publishClipNow(
    String jobId,
    String clipId, {
    String caption = '',
  }) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/clips/' +
        Uri.encodeComponent(clipId) +
        '/publish';
    final response = await _http
        .post(
          Uri.parse(baseUrl + path),
          headers: _headers(jsonBody: true),
          body: jsonEncode({'caption': caption}),
        )
        .timeout(const Duration(seconds: 45));
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> scheduleClip(
    String jobId,
    String clipId, {
    required DateTime scheduledFor,
    String caption = '',
  }) async {
    final path = '/api/portal/videos/' +
        Uri.encodeComponent(jobId) +
        '/clips/' +
        Uri.encodeComponent(clipId) +
        '/schedule';
    final response = await _http.post(
      Uri.parse(baseUrl + path),
      headers: _headers(jsonBody: true),
      body: jsonEncode({
        'scheduledFor': scheduledFor.toUtc().toIso8601String(),
        'caption': caption,
      }),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> bulkScheduleClips(
    List<Map<String, dynamic>> items,
  ) async {
    final response = await _http.post(
      Uri.parse(baseUrl + '/api/portal/videos/bulk-schedule'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'items': items}),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> createVideoFolder(String name) async {
    final response = await _http.post(
      Uri.parse(baseUrl + '/api/portal/video-folders'),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'name': name.trim()}),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> renameVideoFolder(
    String folderId,
    String name,
  ) async {
    final response = await _http.patch(
      Uri.parse(
        baseUrl +
            '/api/portal/video-folders/' +
            Uri.encodeComponent(folderId),
      ),
      headers: _headers(jsonBody: true),
      body: jsonEncode({'name': name.trim()}),
    );
    final payload = _decode(response);
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  Future<void> deleteVideoFolder(String folderId) async {
    final response = await _http.delete(
      Uri.parse(
        baseUrl +
            '/api/portal/video-folders/' +
            Uri.encodeComponent(folderId),
      ),
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

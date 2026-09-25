import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import 'core/api_client.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = NexusApiClient();
  await api.restoreToken();
  runApp(NexusApp(api: api));
}

class NexusApp extends StatelessWidget {
  final NexusApiClient api;

  const NexusApp({super.key, required this.api});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'NEXUS AI',
      theme: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF070B10),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF00C8FF),
          brightness: Brightness.dark,
        ),
        cardTheme: const CardThemeData(
          margin: EdgeInsets.symmetric(vertical: 6),
        ),
      ),
      home: AuthGate(api: api),
    );
  }
}

class AuthGate extends StatefulWidget {
  final NexusApiClient api;

  const AuthGate({super.key, required this.api});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool loading = true;
  Map<String, dynamic>? client;
  bool master = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      if (widget.api.savedRole == 'master' && widget.api.hasMasterToken) {
        await widget.api.masterStatus();
        if (mounted) setState(() => master = true);
        return;
      }

      if (widget.api.hasToken) {
        final session = await widget.api.session();
        if (mounted) setState(() => client = session);
      }
    } catch (_) {
      if (widget.api.savedRole == 'master') {
        await widget.api.logoutMaster();
      } else {
        await widget.api.logout();
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (master) {
      return MasterShell(
        api: widget.api,
        onLogout: () async {
          await widget.api.logoutMaster();
          if (mounted) setState(() => master = false);
        },
      );
    }

    if (client == null) {
      return LoginPage(
        api: widget.api,
        onLoggedIn: (value) => setState(() => client = value),
        onMasterLoggedIn: () => setState(() => master = true),
      );
    }

    return ClientShell(
      api: widget.api,
      client: client!,
      onClientUpdated: (value) => setState(() => client = value),
      onLogout: () async {
        await widget.api.logout();
        if (mounted) setState(() => client = null);
      },
    );
  }
}

class LoginPage extends StatefulWidget {
  final NexusApiClient api;
  final ValueChanged<Map<String, dynamic>> onLoggedIn;
  final VoidCallback onMasterLoggedIn;

  const LoginPage({
    super.key,
    required this.api,
    required this.onLoggedIn,
    required this.onMasterLoggedIn,
  });

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final username = TextEditingController();
  final password = TextEditingController();
  bool loading = false;
  String? error;

  Future<void> _login() async {
    if (username.text.trim().isEmpty || password.text.isEmpty) {
      setState(() => error = 'Informe usuário e senha.');
      return;
    }
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final result = await widget.api.loginUnified(username.text, password.text);
      if (result.isMaster) {
        widget.onMasterLoggedIn();
      } else {
        widget.onLoggedIn(result.client!);
      }
    } catch (e) {
      if (mounted) {
        var message = e is NexusApiException ? e.message : e.toString();
        if (message.contains('SocketException') || message.contains('Failed host lookup')) {
          message = 'Sem acesso à internet no aplicativo. Instale a versão corrigida.';
        }
        setState(() => error = message);
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(22),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.hub_outlined, size: 52),
                      const SizedBox(height: 12),
                      Text(
                        'NEXUS AI',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                      ),
                      const SizedBox(height: 18),
                      TextField(
                        controller: username,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Usuário',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: password,
                        obscureText: true,
                        onSubmitted: (_) => _login(),
                        decoration: const InputDecoration(
                          labelText: 'Senha',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      if (error != null) ...[
                        const SizedBox(height: 12),
                        Text(error!, style: const TextStyle(color: Colors.redAccent)),
                      ],
                      const SizedBox(height: 18),
                      FilledButton.icon(
                        onPressed: loading ? null : _login,
                        icon: loading
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.login),
                        label: const Text('Entrar'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}


class MasterShell extends StatefulWidget {
  final NexusApiClient api;
  final Future<void> Function() onLogout;

  const MasterShell({
    super.key,
    required this.api,
    required this.onLogout,
  });

  @override
  State<MasterShell> createState() => _MasterShellState();
}

class _MasterShellState extends State<MasterShell> {
  bool loading = true;
  Map<String, dynamic> status = {};
  List<dynamic> clients = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final values = await Future.wait([
        widget.api.masterStatus(),
        widget.api.masterClients(),
      ]);
      status = Map<String, dynamic>.from(values[0] as Map);
      clients = List<dynamic>.from(values[1] as List);
    } catch (e) {
      if (mounted) {
        showMessage(
          context,
          e is NexusApiException ? e.message : e.toString(),
          error: true,
        );
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('NEXUS AI · MASTER'),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Sair',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text(
              'Painel Master',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 10),
            Card(
              child: ListTile(
                leading: const Icon(Icons.cloud_done_outlined),
                title: const Text('Servidor NEXUS'),
                subtitle: Text(
                  loading
                      ? 'Verificando...'
                      : 'Cloudflare · ${status['database'] ?? 'D1'} · ${clients.length} clientes',
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Clientes',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 6),
            if (loading)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (clients.isEmpty)
              const Card(
                child: ListTile(
                  title: Text('Nenhum cliente cadastrado'),
                ),
              )
            else
              for (final raw in clients)
                if (raw is Map)
                  Card(
                    child: ListTile(
                      leading: const CircleAvatar(
                        child: Icon(Icons.business_outlined),
                      ),
                      title: Text((raw['name'] ?? raw['id'] ?? 'Cliente').toString()),
                      subtitle: Text(
                        '${raw['instagram'] ?? 'Instagram pendente'} · ${raw['niche'] ?? 'Nicho não informado'}',
                      ),
                      trailing: Text((raw['status'] ?? 'setup').toString()),
                    ),
                  ),
          ],
        ),
      ),
    );
  }
}

class ClientShell extends StatefulWidget {
  final NexusApiClient api;
  final Map<String, dynamic> client;
  final ValueChanged<Map<String, dynamic>> onClientUpdated;
  final Future<void> Function() onLogout;

  const ClientShell({
    super.key,
    required this.api,
    required this.client,
    required this.onClientUpdated,
    required this.onLogout,
  });

  @override
  State<ClientShell> createState() => _ClientShellState();
}

class _ClientShellState extends State<ClientShell> {
  int index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomePage(api: widget.api, client: widget.client),
      VideosPage(api: widget.api),
      PostsPage(api: widget.api),
      ProfilePage(
        api: widget.api,
        client: widget.client,
        onClientUpdated: widget.onClientUpdated,
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.client['name']?.toString().isNotEmpty == true
            ? widget.client['name'].toString()
            : 'NEXUS AI'),
        actions: [
          IconButton(
            tooltip: 'Sair',
            onPressed: widget.onLogout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: IndexedStack(index: index, children: pages),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Início',
          ),
          NavigationDestination(
            icon: Icon(Icons.video_library_outlined),
            selectedIcon: Icon(Icons.video_library),
            label: 'Vídeos',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_month_outlined),
            selectedIcon: Icon(Icons.calendar_month),
            label: 'Postagens',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Perfil',
          ),
        ],
      ),
    );
  }
}

class PageFrame extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const PageFrame({super.key, required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {},
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

void showMessage(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: error ? Colors.red.shade800 : null,
    ),
  );
}

class HomePage extends StatefulWidget {
  final NexusApiClient api;
  final Map<String, dynamic> client;

  const HomePage({super.key, required this.api, required this.client});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  bool loading = true;
  Map<String, dynamic> status = {};
  List<dynamic> connections = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final values = await Future.wait([
        widget.api.liveStatus(),
        widget.api.connections(),
      ]);
      status = Map<String, dynamic>.from(values[0] as Map);
      connections = List<dynamic>.from(values[1] as List);
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  bool get instagramConnected {
    for (final item in connections) {
      if (item is Map && item['provider']?.toString().toLowerCase() == 'instagram') {
        return true;
      }
    }
    return (widget.client['instagram'] ?? '').toString().isNotEmpty;
  }

  Future<void> _connectInstagram() async {
    try {
      final uri = await widget.api.startInstagramConnection();
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        showMessage(context, 'Não foi possível abrir o Instagram.', error: true);
      }
    } catch (e) {
      if (mounted) {
        showMessage(
          context,
          e is NexusApiException ? e.message : e.toString(),
          error: true,
        );
      }
    }
  }

  Future<void> _searchTrailer() async {
    final controller = TextEditingController();
    final query = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Buscar trailer'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Nome do filme ou série',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Buscar'),
          ),
        ],
      ),
    );

    if (query == null || query.isEmpty) return;
    try {
      if (mounted) showMessage(context, 'Buscando dentro do NEXUS...');
      final data = await widget.api.searchTrailers(query);
      final results = data['results'] is List
          ? List<dynamic>.from(data['results'] as List)
          : <dynamic>[];
      if (!mounted) return;
      if (results.isEmpty) {
        showMessage(context, 'Nenhum trailer utilizável foi encontrado.', error: true);
        return;
      }

      final selected = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        builder: (context) => SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * .72,
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(18, 16, 18, 8),
                  child: Row(
                    children: [
                      Icon(Icons.search),
                      SizedBox(width: 10),
                      Text(
                        'Resultados do NEXUS',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: results.length,
                    itemBuilder: (context, index) {
                      final raw = results[index];
                      if (raw is! Map) return const SizedBox.shrink();
                      final item = Map<String, dynamic>.from(raw);
                      final title = (item['title'] ?? 'Trailer').toString();
                      final year = (item['year'] ?? '').toString();
                      final channel = (item['trailerName'] ?? '').toString();
                      return ListTile(
                        leading: const Icon(Icons.play_circle_outline),
                        title: Text(title),
                        subtitle: Text(
                          [year, channel].where((value) => value.isNotEmpty).join(' · '),
                        ),
                        trailing: const Icon(Icons.add_circle_outline),
                        onTap: () => Navigator.pop(context, item),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected == null) return;

      final trailerUrl = (selected['trailerUrl'] ?? '').toString();
      final title = (selected['title'] ?? query).toString();
      if (trailerUrl.isEmpty) {
        if (mounted) showMessage(context, 'Esse resultado não possui vídeo importável.', error: true);
        return;
      }

      await widget.api.importTrailer(
        trailerUrl,
        title: title,
        settings: const {
          'requestedClips': 3,
          'clipDuration': 30,
          'outputFormat': 'reel',
          'autoSubtitles': true,
          'goal': 'viral',
        },
      );
      if (mounted) {
        showMessage(context, 'Trailer enviado para a biblioteca. O NEXUS vai processar os cortes.');
      }
    } catch (e) {
      if (mounted) {
        showMessage(
          context,
          e is NexusApiException ? e.message : e.toString(),
          error: true,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Text(
            'Início',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 10),
          Card(
            child: ListTile(
              leading: Icon(
                status['runtime'] == 'cloudflare-workers'
                    ? Icons.cloud_done_outlined
                    : Icons.cloud_outlined,
              ),
              title: const Text('Servidor NEXUS'),
              subtitle: Text(
                loading
                    ? 'Verificando...'
                    : 'Cloudflare · ${status['database'] ?? 'D1'} · mídia ${status['media'] ?? 'indisponível'}',
              ),
              trailing: IconButton(
                onPressed: _load,
                icon: const Icon(Icons.refresh),
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.search),
              title: const Text('Buscar trailer'),
              subtitle: const Text('Busca por trailer oficial dublado.'),
              trailing: FilledButton.tonal(
                onPressed: _searchTrailer,
                child: const Text('Buscar'),
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: Icon(
                instagramConnected ? Icons.check_circle : Icons.link,
              ),
              title: const Text('Instagram'),
              subtitle: Text(
                instagramConnected
                    ? 'Conta conectada'
                    : 'Conecte a conta usada nas publicações.',
              ),
              trailing: FilledButton.tonal(
                onPressed: _connectInstagram,
                child: Text(instagramConnected ? 'Reconectar' : 'Conectar'),
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.auto_awesome_outlined),
              title: const Text('Agente'),
              subtitle: Text(
                '${widget.client['niche'] ?? 'Nicho não informado'} · ${widget.client['status'] ?? 'online'}',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class VideosPage extends StatefulWidget {
  final NexusApiClient api;

  const VideosPage({super.key, required this.api});

  @override
  State<VideosPage> createState() => _VideosPageState();
}

class _VideosPageState extends State<VideosPage> {
  static const int maxVideoBytes = 100 * 1024 * 1024;

  bool loading = true;
  bool actionBusy = false;
  String busyLabel = '';
  double? uploadProgress;
  List<dynamic> jobs = [];
  List<dynamic> folders = [];
  String folderFilter = '';
  Timer? poller;
  final Set<String> selectedClips = <String>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    poller?.cancel();
    super.dispose();
  }

  String _errorText(Object error) {
    if (error is NexusApiException) return error.message;
    return error.toString().replaceFirst('Exception: ', '');
  }

  bool _isActiveStatus(String value) {
    return const {
      'importing',
      'queued',
      'processing',
      'uploaded',
      'transcribing',
      'selecting',
      'cutting',
    }.contains(value);
  }

  String _jobStatus(String value) {
    const labels = <String, String>{
      'importing': 'IMPORTANDO',
      'awaiting_configuration': 'AGUARDANDO CONFIGURAÇÃO',
      'queued': 'NA FILA',
      'processing': 'PROCESSANDO',
      'uploaded': 'RECEBIDO',
      'transcribing': 'TRANSCREVENDO',
      'selecting': 'ESCOLHENDO CORTES',
      'cutting': 'CRIANDO CORTES',
      'ready': 'PRONTO',
      'failed': 'FALHOU',
    };
    return labels[value] ?? value.toUpperCase();
  }

  String _clipStatus(Map clip) {
    final publish = (clip['publishStatus'] ?? 'draft').toString();
    if (publish == 'published') return 'PUBLICADO';
    if (publish == 'publishing') return 'PUBLICANDO';
    if (publish == 'scheduled') return 'AGENDADO';
    if (publish == 'failed') return 'FALHA NO ENVIO';
    final approval = (clip['approvalStatus'] ?? 'pending').toString();
    if (approval == 'approved') return 'APROVADO';
    if (approval == 'rejected') return 'REPROVADO';
    return 'AGUARDANDO APROVAÇÃO';
  }

  String _mimeForName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    return 'video/mp4';
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => loading = true);
    try {
      final data = await widget.api.videos();
      if (!mounted) return;
      final nextJobs = data['jobs'] is List
          ? List<dynamic>.from(data['jobs'] as List)
          : <dynamic>[];
      final nextFolders = data['folders'] is List
          ? List<dynamic>.from(data['folders'] as List)
          : <dynamic>[];
      setState(() {
        jobs = nextJobs;
        folders = nextFolders;
      });
      _schedulePolling();
    } catch (e) {
      if (mounted && !silent) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted && !silent) setState(() => loading = false);
    }
  }

  void _schedulePolling() {
    poller?.cancel();
    final active = jobs.any(
      (raw) => raw is Map && _isActiveStatus((raw['status'] ?? '').toString()),
    );
    if (!active) return;
    poller = Timer(const Duration(seconds: 5), () {
      if (mounted) _load(silent: true);
    });
  }

  Future<Map<String, dynamic>?> _settingsDialog({
    Map<dynamic, dynamic>? source,
    String? suggestedTitle,
  }) async {
    final title = TextEditingController(
      text: (source?['contentTitle'] ?? suggestedTitle ?? '').toString(),
    );
    final endText = TextEditingController(
      text: (source?['endText'] ?? '').toString(),
    );
    final endContact = TextEditingController(
      text: (source?['endContact'] ?? '').toString(),
    );
    var clips = int.tryParse((source?['requestedClips'] ?? 3).toString()) ?? 3;
    var duration = int.tryParse((source?['clipDuration'] ?? 30).toString()) ?? 30;
    var format = (source?['outputFormat'] ?? 'reel').toString();
    if (!const {'reel', 'feed'}.contains(format)) format = 'reel';
    var subtitles = source?['autoSubtitles'] != false;

    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => AlertDialog(
          title: const Text('Configurar cortes'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: title,
                  decoration: const InputDecoration(
                    labelText: 'Título do conteúdo',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  value: clips.clamp(1, 12),
                  decoration: const InputDecoration(
                    labelText: 'Quantidade de cortes',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    12,
                    (index) => DropdownMenuItem(
                      value: index + 1,
                      child: Text((index + 1).toString()),
                    ),
                  ),
                  onChanged: (value) {
                    if (value != null) setLocalState(() => clips = value);
                  },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  value: const [10, 15, 20, 30, 45, 60, 90].contains(duration)
                      ? duration
                      : 30,
                  decoration: const InputDecoration(
                    labelText: 'Duração máxima de cada corte',
                    border: OutlineInputBorder(),
                  ),
                  items: const [10, 15, 20, 30, 45, 60, 90]
                      .map(
                        (value) => DropdownMenuItem(
                          value: value,
                          child: Text('Até ' + value.toString() + ' segundos'),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setLocalState(() => duration = value);
                  },
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: format,
                  decoration: const InputDecoration(
                    labelText: 'Formato',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'reel', child: Text('Vertical 9:16')),
                    DropdownMenuItem(value: 'feed', child: Text('Feed')),
                  ],
                  onChanged: (value) {
                    if (value != null) setLocalState(() => format = value);
                  },
                ),
                SwitchListTile(
                  value: subtitles,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Legendas automáticas'),
                  subtitle: const Text('Mantém texto dentro da área segura.'),
                  onChanged: (value) => setLocalState(() => subtitles = value),
                ),
                TextField(
                  controller: endText,
                  decoration: const InputDecoration(
                    labelText: 'Frase final opcional',
                    hintText: 'Ex.: Continua...',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: endContact,
                  decoration: const InputDecoration(
                    labelText: 'Contato final opcional',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, <String, dynamic>{
                'contentTitle': title.text.trim(),
                'goal': 'viral',
                'requestedClips': clips,
                'clips': clips,
                'clipDuration': duration,
                'duration': duration,
                'outputFormat': format,
                'autoSubtitles': subtitles,
                'endText': endText.text.trim(),
                'endContact': endContact.text.trim(),
              }),
              child: const Text('Continuar'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _uploadFromDevice() async {
    if (actionBusy) return;
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['mp4', 'mov', 'webm', 'mkv'],
      allowMultiple: false,
      withData: false,
    );
    if (picked == null || picked.files.isEmpty) return;
    final selected = picked.files.single;
    if (selected.path == null || selected.path!.isEmpty) {
      if (mounted) {
        showMessage(
          context,
          'O Android não liberou acesso ao arquivo selecionado.',
          error: true,
        );
      }
      return;
    }

    final file = File(selected.path!);
    final size = await file.length();
    if (size <= 0) {
      if (mounted) showMessage(context, 'O arquivo está vazio.', error: true);
      return;
    }
    if (size > maxVideoBytes) {
      if (mounted) {
        showMessage(context, 'O vídeo ultrapassa o limite de 100 MB.', error: true);
      }
      return;
    }

    final settings = await _settingsDialog(suggestedTitle: selected.name);
    if (settings == null) return;

    Map<String, dynamic>? upload;
    RandomAccessFile? reader;
    try {
      setState(() {
        actionBusy = true;
        busyLabel = 'Enviando vídeo para a biblioteca...';
        uploadProgress = 0;
      });

      final contentType = _mimeForName(selected.name);
      upload = await widget.api.createVideoUpload(
        fileName: selected.name,
        size: size,
        contentType: contentType,
      );
      final key = (upload['key'] ?? '').toString();
      final uploadId = (upload['uploadId'] ?? '').toString();
      final chunkSize = int.tryParse((upload['chunkSize'] ?? 8388608).toString()) ?? 8388608;
      if (key.isEmpty || uploadId.isEmpty) {
        throw const NexusApiException('O servidor não iniciou o envio do vídeo.');
      }

      reader = await file.open();
      var offset = 0;
      var partNumber = 1;
      final parts = <Map<String, dynamic>>[];
      while (offset < size) {
        final remaining = size - offset;
        final length = remaining < chunkSize ? remaining : chunkSize;
        await reader.setPosition(offset);
        final bytes = await reader.read(length);
        if (bytes.isEmpty) {
          throw const NexusApiException('Falha ao ler o vídeo selecionado.');
        }
        final part = await widget.api.uploadVideoPart(
          key: key,
          uploadId: uploadId,
          partNumber: partNumber,
          bytes: bytes,
        );
        parts.add(<String, dynamic>{
          'partNumber': part['partNumber'] ?? partNumber,
          'etag': (part['etag'] ?? '').toString(),
        });
        offset += bytes.length;
        partNumber += 1;
        if (mounted) {
          setState(() => uploadProgress = offset / size);
        }
      }

      await reader.close();
      reader = null;
      await widget.api.completeVideoUpload(
        key: key,
        uploadId: uploadId,
        parts: parts,
        size: size,
        fileName: selected.name,
        contentType: contentType,
        settings: settings,
      );
      if (mounted) {
        showMessage(
          context,
          'Vídeo enviado. O NEXUS começou a analisar os melhores cortes.',
        );
      }
      await _load(silent: true);
    } catch (e) {
      if (reader != null) await reader.close();
      final key = (upload?['key'] ?? '').toString();
      final uploadId = (upload?['uploadId'] ?? '').toString();
      if (key.isNotEmpty && uploadId.isNotEmpty) {
        await widget.api.abortVideoUpload(key: key, uploadId: uploadId);
      }
      if (mounted) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted) {
        setState(() {
          actionBusy = false;
          busyLabel = '';
          uploadProgress = null;
        });
      }
    }
  }

  Future<void> _importUrl() async {
    if (actionBusy) return;
    final controller = TextEditingController();
    final url = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Importar vídeo por link'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(
            labelText: 'Link HTTPS direto do vídeo',
            hintText: 'https://...',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Continuar'),
          ),
        ],
      ),
    );
    if (url == null || url.isEmpty) return;
    final parsed = Uri.tryParse(url);
    if (parsed == null || parsed.scheme != 'https') {
      if (mounted) showMessage(context, 'Use um link HTTPS válido.', error: true);
      return;
    }
    final settings = await _settingsDialog();
    if (settings == null) return;

    try {
      setState(() {
        actionBusy = true;
        busyLabel = 'Importando vídeo para a biblioteca...';
      });
      await widget.api.importVideoFromUrl(url, settings: settings);
      if (mounted) {
        showMessage(context, 'Vídeo importado. O processamento foi iniciado.');
      }
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted) {
        setState(() {
          actionBusy = false;
          busyLabel = '';
        });
      }
    }
  }

  Future<void> _searchTrailer() async {
    if (actionBusy) return;
    final controller = TextEditingController();
    final query = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Buscar trailer'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Filme ou série',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Buscar'),
          ),
        ],
      ),
    );
    if (query == null || query.isEmpty) return;

    try {
      setState(() {
        actionBusy = true;
        busyLabel = 'Buscando trailers dentro do NEXUS...';
      });
      final data = await widget.api.searchTrailers(query);
      final results = data['results'] is List
          ? List<dynamic>.from(data['results'] as List)
          : <dynamic>[];
      if (!mounted) return;
      setState(() {
        actionBusy = false;
        busyLabel = '';
      });
      if (results.isEmpty) {
        showMessage(context, 'Nenhum trailer utilizável foi encontrado.', error: true);
        return;
      }

      final selected = await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        builder: (context) => SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * .75,
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(18, 16, 18, 8),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Escolha o vídeo',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: results.length,
                    itemBuilder: (context, index) {
                      final raw = results[index];
                      if (raw is! Map) return const SizedBox.shrink();
                      final item = Map<String, dynamic>.from(raw);
                      final title = (item['title'] ?? 'Trailer').toString();
                      final year = (item['year'] ?? '').toString();
                      final channel = (item['trailerName'] ?? '').toString();
                      return ListTile(
                        leading: const Icon(Icons.play_circle_outline),
                        title: Text(title),
                        subtitle: Text(
                          [year, channel].where((value) => value.isNotEmpty).join(' · '),
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => Navigator.pop(context, item),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected == null) return;
      final trailerUrl = (selected['trailerUrl'] ?? '').toString();
      final title = (selected['title'] ?? query).toString();
      if (trailerUrl.isEmpty) {
        showMessage(context, 'Esse resultado não possui vídeo importável.', error: true);
        return;
      }
      final settings = await _settingsDialog(suggestedTitle: title);
      if (settings == null) return;

      setState(() {
        actionBusy = true;
        busyLabel = 'Enviando trailer para a biblioteca...';
      });
      await widget.api.importTrailer(
        trailerUrl,
        title: title,
        settings: settings,
      );
      if (mounted) {
        showMessage(context, 'Importação iniciada. O status atualiza sozinho.');
      }
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted) {
        setState(() {
          actionBusy = false;
          busyLabel = '';
        });
      }
    }
  }

  Future<void> _configureAndProcess(Map item) async {
    if (actionBusy) return;
    final settings = await _settingsDialog(source: item);
    if (settings == null) return;
    try {
      setState(() {
        actionBusy = true;
        busyLabel = 'Salvando configuração e iniciando os cortes...';
      });
      final jobId = item['id'].toString();
      await widget.api.updateVideo(jobId, settings);
      await widget.api.processVideo(jobId, settings);
      if (mounted) showMessage(context, 'Processamento iniciado.');
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted) {
        setState(() {
          actionBusy = false;
          busyLabel = '';
        });
      }
    }
  }

  Future<void> _rename(Map item) async {
    final controller = TextEditingController(
      text: (item['displayName'] ?? item['filename'] ?? '').toString(),
    );
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nome do vídeo'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(border: OutlineInputBorder()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await widget.api.updateVideo(
        item['id'].toString(),
        <String, dynamic>{'displayName': name},
      );
      await _load(silent: true);
      if (mounted) showMessage(context, 'Vídeo atualizado.');
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _delete(Map item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir vídeo?'),
        content: const Text(
          'O vídeo e os cortes vinculados serão removidos da biblioteca. Publicações já enviadas ao Instagram não serão apagadas.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.deleteVideo(item['id'].toString());
      selectedClips.removeWhere(
        (value) => value.startsWith(item['id'].toString() + '|'),
      );
      await _load(silent: true);
      if (mounted) showMessage(context, 'Vídeo excluído.');
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _createFolder() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nova pasta'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Nome',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Criar'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await widget.api.createVideoFolder(name);
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _moveVideo(Map item) async {
    if (folders.isEmpty) return;
    final folderId = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Mover para'),
        children: [
          for (final raw in folders)
            if (raw is Map)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(
                  context,
                  (raw['id'] ?? 'default').toString(),
                ),
                child: Text((raw['name'] ?? 'Meus vídeos').toString()),
              ),
        ],
      ),
    );
    if (folderId == null) return;
    try {
      await widget.api.updateVideo(
        item['id'].toString(),
        <String, dynamic>{'folderId': folderId},
      );
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _approval(Map job, Map clip, String status) async {
    try {
      await widget.api.setClipApproval(
        job['id'].toString(),
        clip['id'].toString(),
        status,
      );
      await _load(silent: true);
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _toggleSelected(Map job, Map clip, bool selected) async {
    final key = job['id'].toString() + '|' + clip['id'].toString();
    setState(() {
      if (selected) {
        selectedClips.add(key);
      } else {
        selectedClips.remove(key);
      }
    });
    try {
      await widget.api.selectClip(
        job['id'].toString(),
        clip['id'].toString(),
        selected,
      );
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<DateTime?> _pickDateTime({DateTime? initial}) async {
    final base = initial ?? DateTime.now().add(const Duration(hours: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
    );
    if (time == null) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _schedule(Map job, Map clip) async {
    final scheduled = await _pickDateTime();
    if (scheduled == null) return;
    final caption = TextEditingController(
      text: (clip['caption'] ?? '').toString(),
    );
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Agendar corte'),
        content: TextField(
          controller: caption,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Legenda da postagem',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Agendar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.scheduleClip(
        job['id'].toString(),
        clip['id'].toString(),
        scheduledFor: scheduled,
        caption: caption.text.trim(),
      );
      selectedClips.remove(
        job['id'].toString() + '|' + clip['id'].toString(),
      );
      await _load(silent: true);
      if (mounted) showMessage(context, 'Corte agendado.');
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _bulkSchedule() async {
    if (selectedClips.isEmpty) return;
    final start = await _pickDateTime();
    if (start == null || !mounted) return;
    var interval = 60;
    final value = await showDialog<int>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Intervalo entre postagens'),
        content: DropdownButtonFormField<int>(
          value: interval,
          items: const [
            DropdownMenuItem(value: 30, child: Text('30 minutos')),
            DropdownMenuItem(value: 60, child: Text('1 hora')),
            DropdownMenuItem(value: 120, child: Text('2 horas')),
            DropdownMenuItem(value: 180, child: Text('3 horas')),
            DropdownMenuItem(value: 360, child: Text('6 horas')),
            DropdownMenuItem(value: 1440, child: Text('1 dia')),
          ],
          onChanged: (next) {
            if (next != null) interval = next;
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, interval),
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
    if (value == null) return;

    final items = <Map<String, dynamic>>[];
    var index = 0;
    for (final key in selectedClips) {
      final parts = key.split('|');
      if (parts.length != 2) continue;
      items.add(<String, dynamic>{
        'jobId': parts[0],
        'clipId': parts[1],
        'scheduledFor': start
            .add(Duration(minutes: value * index))
            .toUtc()
            .toIso8601String(),
      });
      index += 1;
    }
    try {
      final result = await widget.api.bulkScheduleClips(items);
      selectedClips.clear();
      await _load(silent: true);
      if (mounted) {
        showMessage(
          context,
          (result['scheduled'] ?? 0).toString() + ' corte(s) agendado(s).',
        );
      }
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _publishNow(Map job, Map clip) async {
    if ((clip['approvalStatus'] ?? '').toString() != 'approved') {
      if (mounted) {
        showMessage(context, 'Aprove o corte antes de publicar.', error: true);
      }
      return;
    }
    final caption = TextEditingController(
      text: (clip['caption'] ?? '').toString(),
    );
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Publicar agora?'),
        content: TextField(
          controller: caption,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Legenda',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Publicar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.publishClipNow(
        job['id'].toString(),
        clip['id'].toString(),
        caption: caption.text.trim(),
      );
      await _load(silent: true);
      if (mounted) showMessage(context, 'Corte publicado.');
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    }
  }

  Future<void> _adjust(Map job, Map clip) async {
    final start = TextEditingController(text: (clip['start'] ?? 0).toString());
    final end = TextEditingController(text: (clip['end'] ?? 30).toString());
    final title = TextEditingController(text: (clip['title'] ?? '').toString());
    final caption = TextEditingController(text: (clip['caption'] ?? '').toString());
    final patch = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ajustar corte'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: start,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Início em segundos',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: end,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Fim em segundos',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: title,
                decoration: const InputDecoration(
                  labelText: 'Título',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: caption,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Legenda',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, <String, dynamic>{
              'start': double.tryParse(start.text) ?? 0,
              'end': double.tryParse(end.text) ?? 30,
              'title': title.text.trim(),
              'caption': caption.text.trim(),
            }),
            child: const Text('Gerar novamente'),
          ),
        ],
      ),
    );
    if (patch == null) return;
    try {
      setState(() {
        actionBusy = true;
        busyLabel = 'Gerando o corte ajustado...';
      });
      await widget.api.adjustClip(
        job['id'].toString(),
        clip['id'].toString(),
        patch,
      );
      await _load(silent: true);
      if (mounted) showMessage(context, 'Corte atualizado.');
    } catch (e) {
      if (mounted) showMessage(context, _errorText(e), error: true);
    } finally {
      if (mounted) {
        setState(() {
          actionBusy = false;
          busyLabel = '';
        });
      }
    }
  }

  void _preview(Map clip) {
    final url = (clip['previewUrl'] ?? '').toString();
    if (url.isEmpty) {
      showMessage(context, 'Prévia ainda não disponível.', error: true);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoPreviewPage(
          api: widget.api,
          url: url,
          title: (clip['title'] ?? 'Prévia do corte').toString(),
        ),
      ),
    );
  }

  Widget _clipCard(Map job, Map clip, int index) {
    final key = job['id'].toString() + '|' + clip['id'].toString();
    final selected = selectedClips.contains(key) ||
        clip['selectedForSchedule'] == true;
    final preview = (clip['previewUrl'] ?? '').toString();
    final approval = (clip['approvalStatus'] ?? 'pending').toString();
    final publish = (clip['publishStatus'] ?? 'draft').toString();

    return Card(
      margin: const EdgeInsets.fromLTRB(12, 5, 12, 5),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Checkbox(
                  value: selected,
                  onChanged: publish == 'published'
                      ? null
                      : (value) => _toggleSelected(job, clip, value == true),
                ),
                Expanded(
                  child: Text(
                    (clip['title'] ?? 'Corte ' + (index + 1).toString()).toString(),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                Text(
                  _clipStatus(clip),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
            if ((clip['transcript'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  (clip['transcript'] ?? '').toString(),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            if ((clip['scheduledFor'] ?? '').toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('Agendado: ' + clip['scheduledFor'].toString()),
              ),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                if (preview.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => _preview(clip),
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Ver'),
                  ),
                FilledButton.tonalIcon(
                  onPressed: () => _approval(job, clip, 'approved'),
                  icon: Icon(
                    approval == 'approved'
                        ? Icons.check_circle
                        : Icons.check_circle_outline,
                  ),
                  label: const Text('Aprovar'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _adjust(job, clip),
                  icon: const Icon(Icons.tune),
                  label: const Text('Ajustar'),
                ),
                OutlinedButton.icon(
                  onPressed: publish == 'published' ? null : () => _schedule(job, clip),
                  icon: const Icon(Icons.schedule),
                  label: const Text('Agendar'),
                ),
                FilledButton.icon(
                  onPressed: publish == 'published' || approval != 'approved'
                      ? null
                      : () => _publishNow(job, clip),
                  icon: const Icon(Icons.send),
                  label: const Text('Publicar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _jobCard(Map item) {
    final status = (item['status'] ?? '').toString();
    final clips = item['clips'] is List
        ? List<dynamic>.from(item['clips'] as List)
        : <dynamic>[];
    final progress = double.tryParse((item['progress'] ?? '').toString());
    final message = (item['message'] ?? '').toString();
    final error = (item['error'] ?? '').toString();
    final canProcess = status == 'awaiting_configuration' || status == 'failed';

    return Card(
      child: ExpansionTile(
        leading: Icon(
          status == 'ready'
              ? Icons.video_library
              : status == 'failed'
                  ? Icons.error_outline
                  : Icons.movie_outlined,
        ),
        title: Text(
          (item['displayName'] ?? item['filename'] ?? item['id'] ?? 'Vídeo').toString(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_jobStatus(status) + ' · ' + clips.length.toString() + ' corte(s)'),
            if (message.isNotEmpty)
              Text(
                message,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            if (error.isNotEmpty)
              Text(
                error,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.redAccent),
              ),
            if (progress != null && progress > 0 && progress < 100)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: LinearProgressIndicator(value: progress / 100),
              ),
          ],
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (value) {
            if (value == 'rename') _rename(item);
            if (value == 'move') _moveVideo(item);
            if (value == 'delete') _delete(item);
          },
          itemBuilder: (context) => const [
            PopupMenuItem(value: 'rename', child: Text('Renomear')),
            PopupMenuItem(value: 'move', child: Text('Mover para pasta')),
            PopupMenuItem(value: 'delete', child: Text('Excluir')),
          ],
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Cortes: ' +
                        (item['requestedClips'] ?? 3).toString() +
                        ' · até ' +
                        (item['clipDuration'] ?? 30).toString() +
                        's · ' +
                        (item['outputFormat'] ?? 'reel').toString(),
                  ),
                ),
                if (canProcess)
                  FilledButton.tonalIcon(
                    onPressed: () => _configureAndProcess(item),
                    icon: const Icon(Icons.content_cut),
                    label: Text(status == 'failed' ? 'Tentar de novo' : 'Fazer cortes'),
                  ),
              ],
            ),
          ),
          if (clips.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text('Os cortes aparecerão aqui quando o processamento terminar.'),
            )
          else
            for (var index = 0; index < clips.length; index++)
              if (clips[index] is Map)
                _clipCard(item, clips[index] as Map, index),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final visibleJobs = jobs.where((raw) {
      if (raw is! Map) return false;
      if (folderFilter.isEmpty) return true;
      return (raw['folderId'] ?? 'default').toString() == folderFilter;
    }).toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Vídeos',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              IconButton(
                tooltip: 'Atualizar',
                onPressed: actionBusy ? null : _load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: actionBusy ? null : _uploadFromDevice,
                icon: const Icon(Icons.upload_file),
                label: const Text('Enviar do aparelho'),
              ),
              FilledButton.tonalIcon(
                onPressed: actionBusy ? null : _importUrl,
                icon: const Icon(Icons.link),
                label: const Text('Importar link'),
              ),
              FilledButton.tonalIcon(
                onPressed: actionBusy ? null : _searchTrailer,
                icon: const Icon(Icons.search),
                label: const Text('Buscar trailer'),
              ),
              OutlinedButton.icon(
                onPressed: actionBusy ? null : _createFolder,
                icon: const Icon(Icons.create_new_folder_outlined),
                label: const Text('Nova pasta'),
              ),
              if (selectedClips.isNotEmpty)
                FilledButton.icon(
                  onPressed: actionBusy ? null : _bulkSchedule,
                  icon: const Icon(Icons.calendar_month),
                  label: Text(
                    'Agendar selecionados (' + selectedClips.length.toString() + ')',
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            value: folderFilter,
            decoration: const InputDecoration(
              labelText: 'Pasta',
              border: OutlineInputBorder(),
            ),
            items: [
              const DropdownMenuItem(value: '', child: Text('Todas as pastas')),
              for (final raw in folders)
                if (raw is Map)
                  DropdownMenuItem(
                    value: (raw['id'] ?? 'default').toString(),
                    child: Text((raw['name'] ?? 'Meus vídeos').toString()),
                  ),
            ],
            onChanged: (value) => setState(() => folderFilter = value ?? ''),
          ),
          if (actionBusy) ...[
            const SizedBox(height: 12),
            LinearProgressIndicator(value: uploadProgress),
            const SizedBox(height: 6),
            Text(busyLabel),
          ],
          const SizedBox(height: 10),
          if (loading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (visibleJobs.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.video_library_outlined),
                title: Text('Biblioteca vazia'),
                subtitle: Text(
                  'Envie um vídeo do telefone, importe um link ou busque um trailer.',
                ),
              ),
            )
          else
            for (final raw in visibleJobs)
              if (raw is Map) _jobCard(raw),
        ],
      ),
    );
  }
}

class VideoPreviewPage extends StatefulWidget {
  final NexusApiClient api;
  final String url;
  final String title;

  const VideoPreviewPage({
    super.key,
    required this.api,
    required this.url,
    required this.title,
  });

  @override
  State<VideoPreviewPage> createState() => _VideoPreviewPageState();
}

class _VideoPreviewPageState extends State<VideoPreviewPage> {
  late final VideoPlayerController controller;
  Future<void>? initializing;

  @override
  void initState() {
    super.initState();
    controller = VideoPlayerController.networkUrl(
      widget.api.absoluteUri(widget.url),
      httpHeaders: widget.api.mediaHeaders,
    );
    initializing = controller.initialize().then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Center(
        child: FutureBuilder<void>(
          future: initializing,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const CircularProgressIndicator();
            }
            if (snapshot.hasError || !controller.value.isInitialized) {
              return const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Não foi possível carregar a prévia desse corte.'),
              );
            }
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AspectRatio(
                  aspectRatio: controller.value.aspectRatio == 0
                      ? 9 / 16
                      : controller.value.aspectRatio,
                  child: VideoPlayer(controller),
                ),
                const SizedBox(height: 12),
                IconButton.filled(
                  onPressed: () {
                    setState(() {
                      if (controller.value.isPlaying) {
                        controller.pause();
                      } else {
                        controller.play();
                      }
                    });
                  },
                  icon: Icon(
                    controller.value.isPlaying ? Icons.pause : Icons.play_arrow,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class PostsPage extends StatefulWidget {
  final NexusApiClient api;

  const PostsPage({super.key, required this.api});

  @override
  State<PostsPage> createState() => _PostsPageState();
}

class _PostsPageState extends State<PostsPage> {
  bool loading = true;
  List<dynamic> posts = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      posts = await widget.api.posts();
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _approve(String id) async {
    try {
      final result = await widget.api.decidePost(id, 'approved');
      if (mounted) showMessage(context, (result['message'] ?? 'Postagem aprovada.').toString());
      await _load();
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    }
  }

  Future<void> _publish(String id) async {
    try {
      final result = await widget.api.publishPostNow(id);
      if (mounted) showMessage(context, (result['message'] ?? 'Postagem enviada.').toString());
      await _load();
    } catch (e) {
      if (mounted) {
        showMessage(
          context,
          e is NexusApiException ? e.message : e.toString(),
          error: true,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Postagens',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                ),
              ),
              IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
            ],
          ),
          if (loading)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (posts.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.calendar_month_outlined),
                title: Text('Nenhuma postagem'),
                subtitle: Text('O histórico aparecerá aqui.'),
              ),
            )
          else
            for (final raw in posts)
              if (raw is Map)
                Card(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          (raw['caption'] ?? 'Postagem').toString(),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Status: ${raw['status'] ?? '-'} · Aprovação: ${raw['approvalStatus'] ?? raw['approval_status'] ?? '-'}',
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          children: [
                            if ((raw['approvalStatus'] ?? raw['approval_status'] ?? '').toString() != 'approved')
                              FilledButton.tonal(
                                onPressed: () => _approve(raw['id'].toString()),
                                child: const Text('Aprovar'),
                              ),
                            FilledButton(
                              onPressed: () => _publish(raw['id'].toString()),
                              child: const Text('Publicar agora'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
        ],
      ),
    );
  }
}

class ProfilePage extends StatefulWidget {
  final NexusApiClient api;
  final Map<String, dynamic> client;
  final ValueChanged<Map<String, dynamic>> onClientUpdated;

  const ProfilePage({
    super.key,
    required this.api,
    required this.client,
    required this.onClientUpdated,
  });

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  late final TextEditingController agentName;
  late final TextEditingController audience;
  late final TextEditingController cta;
  late final TextEditingController whatsapp;
  late final TextEditingController instagram;
  late final TextEditingController website;
  bool saving = false;

  Map<String, dynamic> get profile {
    final value = widget.client['agentProfile'];
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }

  @override
  void initState() {
    super.initState();
    final p = profile;
    agentName = TextEditingController(text: (p['agentName'] ?? widget.client['name'] ?? '').toString());
    audience = TextEditingController(text: (p['audience'] ?? '').toString());
    cta = TextEditingController(text: (p['cta'] ?? 'Digite QUERO').toString());
    whatsapp = TextEditingController(text: (p['whatsapp'] ?? '').toString());
    instagram = TextEditingController(text: (p['instagram'] ?? widget.client['instagram'] ?? '').toString());
    website = TextEditingController(text: (p['website'] ?? '').toString());
  }

  Future<void> _save() async {
    setState(() => saving = true);
    try {
      final result = await widget.api.saveAgentProfile({
        'agentName': agentName.text.trim(),
        'audience': audience.text.trim(),
        'cta': cta.text.trim(),
        'whatsapp': whatsapp.text.trim(),
        'instagram': instagram.text.trim(),
        'website': website.text.trim(),
      });
      final updated = result['client'];
      if (updated is Map) {
        widget.onClientUpdated(Map<String, dynamic>.from(updated));
      }
      if (mounted) showMessage(context, 'Perfil salvo no servidor.');
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> _support() async {
    final subject = TextEditingController();
    final message = TextEditingController();
    final send = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Abrir suporte'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: subject,
              decoration: const InputDecoration(
                labelText: 'Assunto',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: message,
              minLines: 3,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: 'Mensagem',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Enviar')),
        ],
      ),
    );
    if (send != true || message.text.trim().isEmpty) return;
    try {
      await widget.api.createSupportTicket(
        subject.text.trim().isEmpty ? 'Suporte NEXUS' : subject.text.trim(),
        message.text.trim(),
      );
      if (mounted) showMessage(context, 'Solicitação enviada.');
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    }
  }

  Widget field(TextEditingController controller, String label, {TextInputType? keyboardType}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        Text(
          'Perfil',
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
        ),
        const SizedBox(height: 10),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                field(agentName, 'Nome do agente'),
                field(audience, 'Público'),
                field(cta, 'CTA'),
                field(whatsapp, 'WhatsApp', keyboardType: TextInputType.phone),
                field(instagram, 'Instagram'),
                field(website, 'Site', keyboardType: TextInputType.url),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: saving ? null : _save,
                    icon: saving
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_outlined),
                    label: const Text('Salvar perfil'),
                  ),
                ),
              ],
            ),
          ),
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.support_agent),
            title: const Text('Suporte'),
            subtitle: const Text('Abra uma solicitação para o administrador NEXUS.'),
            trailing: FilledButton.tonal(
              onPressed: _support,
              child: const Text('Abrir'),
            ),
          ),
        ),
      ],
    );
  }
}

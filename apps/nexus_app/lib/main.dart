import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

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
      if (item is! Map) continue;
      final provider = item['provider']?.toString().toLowerCase() ?? '';
      final connected = item['connected'] == true;
      if ((provider == 'instagram' || provider == 'meta') && connected) {
        return true;
      }
    }
    final onboarding = widget.client['onboarding'];
    return onboarding is Map && onboarding['instagram'] == true;
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
      final data = await widget.api.searchTrailers(query);
      final raw = data['results'];
      final results = raw is List ? List<dynamic>.from(raw) : <dynamic>[];
      if (!mounted) return;

      if (results.isEmpty) {
        showMessage(context, 'Nenhum trailer encontrado pelo NEXUS.');
        return;
      }

      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Resultados do NEXUS'),
          content: SizedBox(
            width: 520,
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: results.length,
              separatorBuilder: (_, __) => const Divider(),
              itemBuilder: (context, index) {
                final item = results[index] is Map
                    ? Map<String, dynamic>.from(results[index] as Map)
                    : <String, dynamic>{};
                final title = (item['title'] ?? 'Trailer').toString();
                final year = (item['year'] ?? '').toString();
                final official = item['official'] == true;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    official ? Icons.verified_outlined : Icons.movie_outlined,
                  ),
                  title: Text(title),
                  subtitle: Text(
                    [
                      if (year.isNotEmpty) year,
                      official ? 'Trailer oficial localizado' : 'Trailer localizado',
                    ].join(' · '),
                  ),
                );
              },
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
          ],
        ),
      );
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
  bool loading = true;
  List<dynamic> jobs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final data = await widget.api.videos();
      jobs = data['jobs'] is List ? List<dynamic>.from(data['jobs'] as List) : [];
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _rename(Map item) async {
    final settings = item['settings'] is Map ? Map<String, dynamic>.from(item['settings']) : <String, dynamic>{};
    final controller = TextEditingController(text: (settings['name'] ?? '').toString());
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
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    if (name == null || name.isEmpty) return;
    try {
      await widget.api.updateVideo(item['id'].toString(), {'name': name});
      await _load();
      if (mounted) showMessage(context, 'Vídeo atualizado.');
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
    }
  }

  Future<void> _delete(Map item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir vídeo?'),
        content: const Text('O vídeo e os cortes vinculados serão removidos da biblioteca.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
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
      await _load();
      if (mounted) showMessage(context, 'Vídeo excluído.');
    } catch (e) {
      if (mounted) showMessage(context, e.toString(), error: true);
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
                  'Vídeos',
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
          else if (jobs.isEmpty)
            const Card(
              child: ListTile(
                leading: Icon(Icons.video_library_outlined),
                title: Text('Biblioteca vazia'),
                subtitle: Text('Nenhum vídeo registrado no NEXUS ainda.'),
              ),
            )
          else
            for (final raw in jobs)
              if (raw is Map)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.movie_outlined),
                    title: Text(
                      ((raw['settings'] is Map ? raw['settings']['name'] : null) ??
                              raw['id'] ??
                              'Vídeo')
                          .toString(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      'Status: ${raw['status'] ?? '-'} · Cortes: ${raw['clips'] is List ? (raw['clips'] as List).length : 0}',
                    ),
                    trailing: PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'rename') _rename(raw);
                        if (value == 'delete') _delete(raw);
                      },
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: 'rename', child: Text('Renomear')),
                        PopupMenuItem(value: 'delete', child: Text('Excluir')),
                      ],
                    ),
                  ),
                ),
        ],
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

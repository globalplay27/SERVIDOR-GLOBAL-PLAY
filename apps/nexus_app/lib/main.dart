import 'package:flutter/material.dart';

void main() => runApp(const NexusApp());

class NexusApp extends StatelessWidget {
  const NexusApp({super.key});

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
      ),
      home: const ClientShell(),
    );
  }
}

class ClientShell extends StatefulWidget {
  const ClientShell({super.key});

  @override
  State<ClientShell> createState() => _ClientShellState();
}

class _ClientShellState extends State<ClientShell> {
  int index = 0;

  static const pages = [
    _HomePage(),
    _VideosPage(),
    _PostsPage(),
    _ProfilePage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: index, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Início'),
          NavigationDestination(icon: Icon(Icons.video_library_outlined), selectedIcon: Icon(Icons.video_library), label: 'Vídeos'),
          NavigationDestination(icon: Icon(Icons.calendar_month_outlined), selectedIcon: Icon(Icons.calendar_month), label: 'Postagens'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
        ],
      ),
    );
  }
}

class _PageFrame extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _PageFrame({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String action;

  const _QuickCard({required this.icon, required this.title, required this.subtitle, required this.action});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: FilledButton.tonal(onPressed: () {}, child: Text(action)),
      ),
    );
  }
}

class _HomePage extends StatelessWidget {
  const _HomePage();

  @override
  Widget build(BuildContext context) {
    return const _PageFrame(
      title: 'Início',
      children: [
        _QuickCard(icon: Icons.search, title: 'Buscar trailer', subtitle: 'Prioridade para trailer oficial dublado.', action: 'Buscar'),
        _QuickCard(icon: Icons.add_circle_outline, title: 'Novo vídeo', subtitle: 'Gerar e enviar direto para a biblioteca.', action: 'Criar'),
        _QuickCard(icon: Icons.link, title: 'Instagram', subtitle: 'Conecte a conta usada nas publicações.', action: 'Conectar'),
      ],
    );
  }
}

class _VideosPage extends StatelessWidget {
  const _VideosPage();

  @override
  Widget build(BuildContext context) {
    return const _PageFrame(
      title: 'Vídeos',
      children: [
        _QuickCard(icon: Icons.video_library, title: 'Biblioteca', subtitle: 'Vídeos prontos e em processamento.', action: 'Abrir'),
        _QuickCard(icon: Icons.content_cut, title: 'Fazer corte', subtitle: 'Cortar, legendar e adicionar logo.', action: 'Editar'),
      ],
    );
  }
}

class _PostsPage extends StatelessWidget {
  const _PostsPage();

  @override
  Widget build(BuildContext context) {
    return const _PageFrame(
      title: 'Postagens',
      children: [
        _QuickCard(icon: Icons.schedule, title: 'Agendar', subtitle: 'Legenda, CTA e hashtags gerados automaticamente.', action: 'Agendar'),
        _QuickCard(icon: Icons.history, title: 'Histórico', subtitle: 'Acompanhe enviado, pendente ou com erro.', action: 'Ver'),
      ],
    );
  }
}

class _ProfilePage extends StatelessWidget {
  const _ProfilePage();

  @override
  Widget build(BuildContext context) {
    return const _PageFrame(
      title: 'Perfil',
      children: [
        _QuickCard(icon: Icons.person, title: 'Marca e agente', subtitle: 'Nome, nicho, público, CTA e identidade visual.', action: 'Editar'),
        _QuickCard(icon: Icons.image_outlined, title: 'Logo', subtitle: 'Envio com remoção automática de fundo.', action: 'Alterar'),
        _QuickCard(icon: Icons.support_agent, title: 'Suporte', subtitle: 'Abra e acompanhe solicitações.', action: 'Abrir'),
      ],
    );
  }
}

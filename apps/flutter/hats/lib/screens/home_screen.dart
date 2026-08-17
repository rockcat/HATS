import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/app_state.dart';
import '../widgets/agent_card.dart';
import '../widgets/chat_panel.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final PageController _pageCtrl = PageController();
  int _currentAgentIndex = 0;

  @override
  void dispose() {
    _pageCtrl.dispose();
    super.dispose();
  }

  String get _currentAgentName {
    final agents = context.read<AppState>().agents;
    if (agents.isEmpty) return '';
    return agents[_currentAgentIndex.clamp(0, agents.length - 1)].name;
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AppState>(
      builder: (ctx, state, _) {
        final agents = state.agents;
        final agentName = agents.isEmpty
            ? ''
            : agents[_currentAgentIndex.clamp(0, agents.length - 1)].name;

        // Messages for the currently visible agent
        final agentMessages = state.messages
            .where((m) => m.agentName == null || m.agentName == agentName)
            .toList();

        return Scaffold(
          drawer: _buildDrawer(ctx, state),
          body: agents.isEmpty
              ? _buildNoAgents(ctx)
              : _buildMain(ctx, state, agents, agentName, agentMessages),
        );
      },
    );
  }

  Widget _buildMain(
    BuildContext ctx,
    AppState state,
    List agents,
    String agentName,
    List messages,
  ) {
    return Column(
      children: [
        // Top bar
        SafeArea(
          bottom: false,
          child: _TopBar(
            agentIndex: _currentAgentIndex,
            agentCount: agents.length,
            username: state.username ?? '',
          ),
        ),

        // Agent avatar area — 70% of remaining space
        Expanded(
          flex: 7,
          child: PageView.builder(
            controller: _pageCtrl,
            itemCount: agents.length,
            onPageChanged: (i) => setState(() => _currentAgentIndex = i),
            itemBuilder: (ctx, i) => AgentCard(
              agent: agents[i],
              serverUrl: state.serverUrl ?? '',
            ),
          ),
        ),

        // Chat panel — 30% of remaining space
        Expanded(
          flex: 3,
          child: ChatPanel(
            messages: messages.cast(),
            agentName: agentName,
            onSend: (text) {
              if (agentName.isEmpty) return;
              state.addHumanMessage(text, agentName);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildNoAgents(BuildContext ctx) {
    return Scaffold(
      appBar: AppBar(title: const Text('HATS')),
      body: const Center(
        child: Text('No agents in this project yet.\nSet them up in the web app.',
            textAlign: TextAlign.center),
      ),
    );
  }

  Drawer _buildDrawer(BuildContext ctx, AppState state) {
    return Drawer(
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            DrawerHeader(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  const Text('HATS', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4)),
                  if (state.username != null)
                    Text(state.username!, style: const TextStyle(fontSize: 13, color: Colors.grey)),
                ],
              ),
            ),
            ListTile(
              leading: const Icon(Icons.folder_open),
              title: const Text('Project'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.pushNamed(ctx, '/projects');
              },
            ),
            ListTile(
              leading: const Icon(Icons.view_kanban),
              title: const Text('Kanban'),
              onTap: () {
                Navigator.pop(ctx);
                Navigator.pushNamed(ctx, '/kanban');
              },
            ),
            const Spacer(),
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.redAccent),
              title: const Text('Logout', style: TextStyle(color: Colors.redAccent)),
              onTap: () async {
                Navigator.pop(ctx);
                await state.logout();
                if (ctx.mounted) Navigator.pushReplacementNamed(ctx, '/qr');
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  final int agentIndex;
  final int agentCount;
  final String username;

  const _TopBar({required this.agentIndex, required this.agentCount, required this.username});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Row(
        children: [
          Builder(
            builder: (ctx) => IconButton(
              icon: const Icon(Icons.menu),
              onPressed: () => Scaffold.of(ctx).openDrawer(),
            ),
          ),
          const Spacer(),
          if (agentCount > 1)
            Row(
              children: List.generate(
                agentCount,
                (i) => AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: i == agentIndex ? 16 : 6,
                  height: 6,
                  margin: const EdgeInsets.symmetric(horizontal: 2),
                  decoration: BoxDecoration(
                    color: i == agentIndex
                        ? Theme.of(context).colorScheme.primary
                        : Colors.grey,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
            ),
          const Spacer(),
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(username, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ),
        ],
      ),
    );
  }
}

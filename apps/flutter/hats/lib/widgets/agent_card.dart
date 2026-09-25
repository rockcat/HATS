import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/agent.dart';
import '../providers/app_state.dart';
import 'package:hats_avatar_view/hats_avatar_view.dart';

class AgentCard extends StatefulWidget {
  final Agent agent;
  final String serverUrl;
  final AvatarConfig? avatarConfig;

  const AgentCard({
    super.key,
    required this.agent,
    required this.serverUrl,
    this.avatarConfig,
  });

  @override
  State<AgentCard> createState() => _AgentCardState();
}

class _AgentCardState extends State<AgentCard> {
  final _avatarKey = GlobalKey<AvatarViewState>();
  AppState? _appState;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _appState = context.read<AppState>();
      final view = _avatarKey.currentState;
      if (view != null) _appState!.registerAvatarView(widget.agent.name, view);
    });
  }

  @override
  void dispose() {
    _appState?.unregisterAvatarView(widget.agent.name);
    super.dispose();
  }

  Color _hatColor(String hat) {
    switch (hat.toLowerCase()) {
      case 'white':  return Colors.white;
      case 'red':    return Colors.red;
      case 'black':  return Colors.grey[850]!;
      case 'yellow': return Colors.amber;
      case 'green':  return Colors.green;
      case 'blue':   return Colors.blue;
      default:       return Colors.purple;
    }
  }

  Widget _withBackground(Widget child) {
    final bg = widget.agent.background;
    if (bg == null || bg.isEmpty) return child;
    return Container(
      decoration: BoxDecoration(
        image: DecorationImage(
          image: NetworkImage('${widget.serverUrl}/backgrounds/${Uri.encodeComponent(bg)}'),
          fit: BoxFit.cover,
        ),
      ),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final avatarFile = widget.agent.avatar;
    final hatLabel = widget.agent.hatType.isNotEmpty ? widget.agent.hatType.first : '';
    final hatColor = _hatColor(hatLabel);

    return Column(
      children: [
        Expanded(
          child: avatarFile != null
              ? _withBackground(
                  AvatarView(
                    key: _avatarKey,
                    src: '${widget.serverUrl}/avatars/$avatarFile',
                    config: widget.avatarConfig,
                  ),
                )
              : Center(
                  child: CircleAvatar(
                    radius: 80,
                    backgroundColor: hatColor.withValues(alpha: 0.2),
                    child: Text(
                      widget.agent.name.isNotEmpty
                          ? widget.agent.name[0].toUpperCase()
                          : '?',
                      style: TextStyle(fontSize: 64, color: hatColor),
                    ),
                  ),
                ),
        ),

        // Name + hat chip
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                widget.agent.name,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              if (hatLabel.isNotEmpty) ...[
                const SizedBox(width: 10),
                Chip(
                  label: Text(hatLabel, style: const TextStyle(fontSize: 11)),
                  backgroundColor: hatColor.withValues(alpha: 0.2),
                  side: BorderSide(color: hatColor),
                  padding: EdgeInsets.zero,
                  labelPadding: const EdgeInsets.symmetric(horizontal: 6),
                ),
              ],
            ],
          ),
        ),

        // Activity / state
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                widget.agent.isBusy ? Icons.circle : Icons.circle_outlined,
                size: 10,
                color: widget.agent.isBusy ? Colors.green : Colors.grey,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  widget.agent.activity.isEmpty
                      ? widget.agent.state
                      : widget.agent.activity,
                  style: const TextStyle(fontSize: 13, color: Colors.grey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

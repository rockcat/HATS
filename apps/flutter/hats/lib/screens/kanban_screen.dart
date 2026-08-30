import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/ticket.dart';
import '../providers/app_state.dart';

const _columns = ['backlog', 'todo', 'in_progress', 'done'];
const _labels = {'backlog': 'Backlog', 'todo': 'To Do', 'in_progress': 'In Progress', 'done': 'Done'};

class KanbanScreen extends StatefulWidget {
  const KanbanScreen({super.key});

  @override
  State<KanbanScreen> createState() => _KanbanScreenState();
}

class _KanbanScreenState extends State<KanbanScreen> {
  String? _filterColumn;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    await context.read<AppState>().refreshTickets();
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AppState>(
      builder: (ctx, state, _) {
        final all = state.tickets;
        final shown = _filterColumn == null ? all : all.where((t) => t.column == _filterColumn).toList();

        return Scaffold(
          appBar: AppBar(
            title: const Text('Kanban'),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh),
            ],
          ),
          body: Column(
            children: [
              // Filter chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  children: [
                    FilterChip(
                      label: const Text('All'),
                      selected: _filterColumn == null,
                      onSelected: (_) => setState(() => _filterColumn = null),
                    ),
                    const SizedBox(width: 8),
                    ..._columns.map(
                      (col) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: FilterChip(
                          label: Text(_labels[col]!),
                          selected: _filterColumn == col,
                          onSelected: (_) => setState(() => _filterColumn = col),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: _loading
                    ? const Center(child: CircularProgressIndicator())
                    : shown.isEmpty
                        ? const Center(child: Text('No tickets'))
                        : ListView.builder(
                            itemCount: shown.length,
                            itemBuilder: (ctx, i) => _TicketTile(ticket: shown[i]),
                          ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _TicketTile extends StatelessWidget {
  final Ticket ticket;
  const _TicketTile({required this.ticket});

  Color _columnColor(String col) {
    switch (col) {
      case 'in_progress': return Colors.blue;
      case 'done': return Colors.green;
      case 'todo': return Colors.orange;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        title: Text(ticket.title, maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: ticket.assignedTo != null ? Text('→ ${ticket.assignedTo}') : null,
        trailing: Chip(
          label: Text(
            _labels[ticket.column] ?? ticket.column,
            style: const TextStyle(fontSize: 11),
          ),
          backgroundColor: _columnColor(ticket.column).withOpacity(0.2),
          side: BorderSide(color: _columnColor(ticket.column)),
          padding: EdgeInsets.zero,
          labelPadding: const EdgeInsets.symmetric(horizontal: 6),
        ),
      ),
    );
  }
}

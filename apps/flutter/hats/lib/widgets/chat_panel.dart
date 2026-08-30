import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart';
import '../models/chat_message.dart';

class ChatPanel extends StatefulWidget {
  final List<ChatMessage> messages;
  final String agentName;
  final void Function(String text) onSend;

  const ChatPanel({
    super.key,
    required this.messages,
    required this.agentName,
    required this.onSend,
  });

  @override
  State<ChatPanel> createState() => _ChatPanelState();
}

class _ChatPanelState extends State<ChatPanel> {
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();
  final _speech = SpeechToText();
  bool _listening = false;
  bool _speechAvailable = false;

  @override
  void initState() {
    super.initState();
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    _speechAvailable = await _speech.initialize();
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(ChatPanel old) {
    super.didUpdateWidget(old);
    if (widget.messages.length != old.messages.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(_scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
        }
      });
    }
  }

  void _send() {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    _ctrl.clear();
    widget.onSend(text);
  }

  Future<void> _toggleListening() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
    } else {
      setState(() => _listening = true);
      await _speech.listen(
        onResult: (result) {
          if (result.finalResult) {
            final words = result.recognizedWords.trim();
            if (words.isNotEmpty) {
              _ctrl.text = words;
            }
            setState(() => _listening = false);
          }
        },
      );
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _scroll.dispose();
    _speech.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;

    return Column(
      children: [
        Divider(height: 1, color: cs.outline.withOpacity(0.3)),
        Expanded(
          child: widget.messages.isEmpty
              ? Center(
                  child: Text(
                    'Message ${widget.agentName}…',
                    style: TextStyle(color: cs.onSurface.withOpacity(0.4)),
                  ),
                )
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  itemCount: widget.messages.length,
                  itemBuilder: (ctx, i) => _MessageBubble(msg: widget.messages[i]),
                ),
        ),
        _InputBar(
          controller: _ctrl,
          listening: _listening,
          speechAvailable: _speechAvailable,
          onSend: _send,
          onMic: _toggleListening,
        ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final ChatMessage msg;
  const _MessageBubble({required this.msg});

  @override
  Widget build(BuildContext context) {
    final isHuman = msg.sender == MessageSender.human;
    final cs = Theme.of(context).colorScheme;
    return Align(
      alignment: isHuman ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isHuman ? cs.primary : cs.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isHuman && msg.agentName != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(
                  msg.agentName!,
                  style: TextStyle(fontSize: 11, color: cs.primary, fontWeight: FontWeight.bold),
                ),
              ),
            Text(msg.text, style: TextStyle(color: isHuman ? cs.onPrimary : cs.onSurface)),
          ],
        ),
      ),
    );
  }
}

class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final bool listening;
  final bool speechAvailable;
  final VoidCallback onSend;
  final VoidCallback onMic;

  const _InputBar({
    required this.controller,
    required this.listening,
    required this.speechAvailable,
    required this.onSend,
    required this.onMic,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                decoration: InputDecoration(
                  hintText: 'Type a message…',
                  filled: true,
                  fillColor: cs.surfaceContainerHigh,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                ),
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                maxLines: null,
              ),
            ),
            const SizedBox(width: 8),
            if (speechAvailable)
              IconButton(
                icon: Icon(listening ? Icons.mic : Icons.mic_none,
                    color: listening ? cs.error : cs.onSurface),
                onPressed: onMic,
                tooltip: listening ? 'Stop' : 'Speak',
              ),
            IconButton.filled(
              icon: const Icon(Icons.send),
              onPressed: onSend,
            ),
          ],
        ),
      ),
    );
  }
}

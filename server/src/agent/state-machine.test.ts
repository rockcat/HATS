import { describe, it, expect } from 'vitest';
import { AgentState } from './types.js';
import { transition } from './state-machine.js';

describe('State Machine', () => {
  describe('legal transitions', () => {
    it('Idle → Working on task_assigned', () => {
      expect(transition(AgentState.Idle, 'task_assigned')).toBe(AgentState.Working);
    });

    it('Working → Idle on task_complete', () => {
      expect(transition(AgentState.Working, 'task_complete')).toBe(AgentState.Idle);
    });

    it('Working → WaitingForHelp on blocked', () => {
      expect(transition(AgentState.Working, 'blocked')).toBe(AgentState.WaitingForHelp);
    });

    it('Working → InDiscussion on discussion_invited', () => {
      expect(transition(AgentState.Working, 'discussion_invited')).toBe(AgentState.InDiscussion);
    });

    it('WaitingForHelp → Working on help_received', () => {
      expect(transition(AgentState.WaitingForHelp, 'help_received')).toBe(AgentState.Working);
    });

    it('WaitingForHelp → InDiscussion on discussion_invited', () => {
      expect(transition(AgentState.WaitingForHelp, 'discussion_invited')).toBe(AgentState.InDiscussion);
    });

    it('InDiscussion → Working on discussion_ended', () => {
      expect(transition(AgentState.InDiscussion, 'discussion_ended')).toBe(AgentState.Working);
    });

    it('InDiscussion → Idle on task_complete', () => {
      expect(transition(AgentState.InDiscussion, 'task_complete')).toBe(AgentState.Idle);
    });
  });

  describe('illegal transitions', () => {
    it('throws on Idle + task_complete', () => {
      expect(() => transition(AgentState.Idle, 'task_complete')).toThrow();
    });

    it('throws on Idle + blocked', () => {
      expect(() => transition(AgentState.Idle, 'blocked')).toThrow();
    });

    it('throws on Working + help_received', () => {
      expect(() => transition(AgentState.Working, 'help_received')).toThrow();
    });

    it('throws on WaitingForHelp + task_complete', () => {
      expect(() => transition(AgentState.WaitingForHelp, 'task_complete')).toThrow();
    });
  });
});

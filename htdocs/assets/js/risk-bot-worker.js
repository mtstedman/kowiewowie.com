import { chooseBotAction } from './risk-bot.js';

self.onmessage = ({ data }) => {
    const { id, state, seat, options } = data || {};
    try {
        self.postMessage({ id, action: chooseBotAction(state, seat, options) });
    } catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
};

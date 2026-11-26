// 位置のタスクの定義を一番先に読む（バックグラウンドで起こされたとき用）
import './src/trip/trip-runner';
import './src/poc5/background-probe';
import './src/poc6/voice-probe';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);

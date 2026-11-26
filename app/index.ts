// 位置のタスクの定義を一番先に読む（バックグラウンドで起こされたとき用）
import './src/poc5/background-probe';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);

/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';
import './index.css';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() language = 'en-US';

  private client: GoogleGenAI | null = null;
  private sessionPromise: Promise<Session> | null = null;
  // Fix for line 23 & 25: Cast window to any to access webkitAudioContext for older browser compatibility.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      --accent-color: #00ffff; /* Cyan */
      --accent-color-transparent: rgba(0, 255, 255, 0.7);
      --background-color: rgba(10, 20, 30, 0.6);
      --background-hover: rgba(20, 40, 60, 0.8);
      --border-color: rgba(0, 255, 255, 0.2);
      --text-color: #e0f0ff;
      --icon-color: #ffffff;
      --glow-color: rgba(0, 255, 255, 0.5);
    }

    .ui-container {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      z-index: 10;
    }

    #status {
      color: var(--text-color);
      background: transparent;
      padding: 0.5rem 1rem;
      border-radius: 1rem;
      font-size: 1rem;
      font-family: 'Consolas', 'Monaco', monospace;
      transition: opacity 0.3s ease;
      opacity: 1;
      max-width: 90%;
      text-align: center;
      text-shadow: 0 0 5px var(--glow-color), 0 0 10px var(--accent-color);
    }

    #status:empty {
      opacity: 0;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--background-color);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      padding: 0.5rem;
      border-radius: 50px;
      border: 1px solid var(--border-color);
      box-shadow: 0 0 15px 2px var(--glow-color),
        inset 0 0 5px rgba(0, 255, 255, 0.1);
    }

    button {
      position: relative;
      outline: none;
      border: 1px solid transparent;
      color: var(--icon-color);
      border-radius: 50%;
      background: transparent;
      width: 52px;
      height: 52px;
      cursor: pointer;
      font-size: 24px;
      padding: 0;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease-in-out;
    }

    button:hover {
      background: var(--background-hover);
      border-color: var(--border-color);
      transform: scale(1.05);
      box-shadow: 0 0 10px var(--glow-color);
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
      background: transparent;
      box-shadow: none;
      border-color: transparent;
    }

    button:disabled:hover {
      background: transparent;
      border-color: transparent;
    }

    #recordButton {
      width: 72px;
      height: 72px;
      background-color: var(--accent-color);
      border: none;
      box-shadow: 0 0 20px var(--glow-color);
    }

    #recordButton.idle {
      animation: pulse 2s infinite;
    }

    #recordButton.recording {
      background: transparent;
      border: 2px solid var(--accent-color);
      animation: sonar-ring 1.5s infinite ease-out;
    }

    #recordButton svg {
      width: 36px;
      height: 36px;
      transition: transform 0.3s ease;
    }

    #recordButton.recording svg {
      transform: scale(0.8);
    }

    .side-button svg {
      width: 24px;
      height: 24px;
    }

    select {
      outline: none;
      border: 1px solid var(--border-color);
      color: var(--text-color);
      border-radius: 24px;
      background: transparent;
      padding: 0 1.5rem 0 1rem;
      height: 52px;
      cursor: pointer;
      font-size: 1rem;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      text-align: center;
      transition: all 0.2s ease-in-out;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%2300ffff' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
    }

    select:hover {
      background-color: var(--background-hover);
      border-color: var(--accent-color);
      box-shadow: 0 0 10px var(--glow-color);
    }

    select:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }

    select:disabled:hover {
      background: transparent;
      border-color: var(--border-color);
    }

    option {
      background: #0a141e; /* Dark blue background for options */
      color: var(--text-color);
    }

    @keyframes pulse {
      0% {
        transform: scale(0.98);
        box-shadow: 0 0 0 0 var(--accent-color-transparent);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 10px 15px rgba(0, 255, 255, 0);
      }
      100% {
        transform: scale(0.98);
        box-shadow: 0 0 0 0 rgba(0, 255, 255, 0);
      }
    }

    @keyframes sonar-ring {
      0% {
        box-shadow: 0 0 8px 2px var(--accent-color-transparent),
          inset 0 0 5px 1px var(--accent-color-transparent);
      }
      50% {
        box-shadow: 0 0 12px 4px var(--accent-color-transparent),
          inset 0 0 8px 2px var(--accent-color-transparent);
      }
      100% {
        box-shadow: 0 0 8px 2px var(--accent-color-transparent),
          inset 0 0 5px 1px var(--accent-color-transparent);
      }
    }
  `;

  constructor() {
    super();
    if (!process.env.API_KEY) {
      this.error =
        'API_KEY is not configured. Please set the API_KEY environment variable in your deployment settings.';
      this.status = 'Configuration Error';
      return;
    }
    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });
    this.initAudio();
    this.outputNode.connect(this.outputAudioContext.destination);
    this.sessionPromise = this.initSession();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initSession(): Promise<Session> {
    if (!this.client) {
      const errorMessage = 'Gemini client is not initialized.';
      this.updateError(errorMessage);
      return Promise.reject(new Error(errorMessage));
    }
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    return this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('Opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const audioData =
            message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;

          if (audioData) {
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audioData),
              this.outputAudioContext,
              24000,
              1,
            );
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputNode);
            source.addEventListener('ended', () => {
              this.sources.delete(source);
            });

            source.start(this.nextStartTime);
            this.nextStartTime = this.nextStartTime + audioBuffer.duration;
            this.sources.add(source);
          }

          const interrupted = message.serverContent?.interrupted;
          if (interrupted) {
            for (const source of this.sources.values()) {
              source.stop();
              this.sources.delete(source);
            }
            this.nextStartTime = 0;
          }
        },
        onerror: (e: ErrorEvent) => {
          this.updateError(e.message);
        },
        onclose: (e: CloseEvent) => {
          this.updateStatus('Close:' + e.reason);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
          languageCode: this.language,
        },
      },
    });
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording || !this.sessionPromise) {
      return;
    }

    await this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.sessionPromise!.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      console.error('Error starting recording:', err);
      let errorMessage = `Error: ${(err as Error).message}`;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        errorMessage =
          'Microphone permission denied. Please enable it in your browser settings and try again.';
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        errorMessage =
          'No microphone found. Please connect a microphone and try again.';
      }
      this.updateStatus(errorMessage);
      this.stopRecording(true);
    }
  }

  private stopRecording(isError = false) {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    if (!isError) {
      this.updateStatus('Stopping recording...');
    }

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (!isError) {
      this.updateStatus('Recording stopped. Click Start to begin again.');
    }
  }

  private toggleRecording() {
    if (!this.client) {
      this.updateError(
        'Cannot start recording. API Key is not configured correctly.',
      );
      return;
    }
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private reset() {
    if (!this.sessionPromise) {
      this.updateStatus('Cannot reset. Session not initialized.');
      return;
    }
    this.sessionPromise.then((session) => session.close());
    this.sessionPromise = this.initSession();
    this.updateStatus('Session cleared.');
  }

  private handleLanguageChange(e: Event) {
    if (!this.client) {
      this.updateError(
        'Cannot change language. API Key is not configured correctly.',
      );
      const select = e.target as HTMLSelectElement;
      select.value = this.language;
      return;
    }
    this.language = (e.target as HTMLSelectElement).value;
    this.reset();
  }

  render() {
    const recordIcon = html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
    `;
    const stopIcon = html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke-width="1.5">
        <rect x="6" y="6" width="12" height="12" rx="2"></rect>
      </svg>
    `;

    const resetIcon = html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round">
      <path d="M20 10c0-4.4-3.6-8-8-8s-8 3.6-8 8 3.6 8 8 8v-4" />
      <path d="m14 14-4 4 4 4" />
    </svg>`;

    return html`<visual-3d
        .inputNode=${this.inputNode}
        .outputNode=${this.outputNode}></visual-3d>
      <div class="ui-container">
        <div id="status">${this.status}</div>
        <div class="controls">
          <select
            @change=${this.handleLanguageChange}
            ?disabled=${this.isRecording ||
            (!!this.error && !this.isRecording)}>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="fr-FR">French</option>
            <option value="es-ES">Spanish</option>
            <option value="de-DE">German</option>
            <option value="it-IT">Italian</option>
            <option value="ja-JP">Japanese</option>
            <option value="ko-KR">Korean</option>
            <option value="pt-BR">Portuguese</option>
            <option value="ru-RU">Russian</option>
            <option value="zh-CN">Chinese (Mandarin)</option>
            <option value="ar-SA">Arabic</option>
          </select>

          <button
            id="recordButton"
            class=${this.isRecording ? 'recording' : 'idle'}
            @click=${this.toggleRecording}
            ?disabled=${!!this.error && !this.isRecording}>
            ${this.isRecording ? stopIcon : recordIcon}
          </button>

          <button
            class="side-button"
            @click=${this.reset}
            ?disabled=${this.isRecording ||
            (!!this.error && !this.isRecording)}>
            ${resetIcon}
          </button>
        </div>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio': GdmLiveAudio;
  }
}

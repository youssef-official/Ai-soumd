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

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() language = 'en-US';

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session>;
  // Fix for line 23 & 25: Cast window to any to access webkitAudioContext for older browser compatibility.
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      --accent-color: #c80000;
      --background-color: rgba(41, 41, 51, 0.5);
      --background-hover: rgba(55, 55, 65, 0.7);
      --border-color: rgba(255, 255, 255, 0.1);
      --text-color: rgba(255, 255, 255, 0.9);
      --icon-color: #ffffff;
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
      background: rgba(0, 0, 0, 0.3);
      padding: 0.5rem 1rem;
      border-radius: 1rem;
      font-size: 0.9rem;
      transition: opacity 0.3s ease;
      opacity: 1;
      max-width: 90%;
      text-align: center;
    }

    #status:empty {
      opacity: 0;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: var(--background-color);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 0.75rem;
      border-radius: 50px;
      border: 1px solid var(--border-color);
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }

    button {
      outline: none;
      border: none;
      color: var(--icon-color);
      border-radius: 50%;
      background: transparent;
      width: 48px;
      height: 48px;
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
      transform: scale(1.1);
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      background: transparent;
    }
    
    button:disabled:hover {
      background: transparent;
    }

    #recordButton {
      width: 64px;
      height: 64px;
      background: var(--accent-color);
    }

    #recordButton.idle {
      animation: pulse 2s infinite;
    }

    #recordButton.recording {
      background: #1f2937;
      border: 2px solid var(--accent-color);
    }
    
    #recordButton svg {
      width: 32px;
      height: 32px;
    }

    .side-button svg {
      width: 24px;
      height: 24px;
    }

    select {
      outline: none;
      border: none;
      color: var(--text-color);
      border-radius: 24px;
      background: transparent;
      padding: 0 1.25rem;
      height: 48px;
      cursor: pointer;
      font-size: 1rem;
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      text-align: center;
      transition: all 0.2s ease-in-out;
    }
    
    select:hover {
      background: var(--background-hover);
    }

    select:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    select:disabled:hover {
      background: transparent;
    }

    option {
      background: #1f2937;
      color: white;
    }

    @keyframes pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(200, 0, 0, 0.7);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 10px rgba(200, 0, 0, 0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(200, 0, 0, 0);
      }
    }
  `;

  constructor() {
    super();
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
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    return this.client.live.connect({
      model: model,
      callbacks: {
        onopen: () => {
          this.updateStatus('Opened');
        },
        onmessage: async (message: LiveServerMessage) => {
          const audio =
            message.serverContent?.modelTurn?.parts[0]?.inlineData;

          if (audio) {
            this.nextStartTime = Math.max(
              this.nextStartTime,
              this.outputAudioContext.currentTime,
            );

            const audioBuffer = await decodeAudioData(
              decode(audio.data),
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
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

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

        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({media: createBlob(pcmData)});
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

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

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }
  
  private toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private reset() {
    this.sessionPromise.then((session) => session.close());
    this.sessionPromise = this.initSession();
    this.updateStatus('Session cleared.');
  }

  private handleLanguageChange(e: Event) {
    this.language = (e.target as HTMLSelectElement).value;
    this.reset();
  }

  render() {
    const recordIcon = html`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2h2v2a5 5 0 0 0 10 0v-2z"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>`;

    const stopIcon = html`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="6" width="12" height="12"></rect>
      </svg>`;
    
    const resetIcon = html`
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
    </svg>`;

    return html`
      <div>
        <div class="ui-container">
          <div id="status">${this.error || this.status}</div>
          <div class="controls">
            <select
              @change=${this.handleLanguageChange}
              ?disabled=${this.isRecording}>
              <option value="en-US">English</option>
              <option value="ar-SA">العربية</option>
            </select>
            <button
              id="recordButton"
              class=${this.isRecording ? 'recording' : 'idle'}
              @click=${this.toggleRecording}>
              ${this.isRecording ? stopIcon : recordIcon}
            </button>
            <button
              id="resetButton"
              class="side-button"
              @click=${this.reset}
              ?disabled=${this.isRecording}>
              ${resetIcon}
            </button>
          </div>
        </div>

        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}

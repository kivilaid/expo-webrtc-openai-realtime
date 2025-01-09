import React, { useState, useRef, useEffect } from 'react';
import { Button, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AudioVizDOMComponent from './components/audio-visualizer';
import { supabase } from './utils/supabase';
import { Audio } from 'expo-av';
import {
  mediaDevices,
  RTCPeerConnection,
  MediaStream,
  RTCView,
} from 'react-native-webrtc-web-shim';

const App = () => {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [dataChannel, setDataChannel] = useState<null | ReturnType<
    RTCPeerConnection['createDataChannel']
  >>(null);
  const peerConnection = useRef<null | RTCPeerConnection>(null);
  const [localMediaStream, setLocalMediaStream] = useState<null | MediaStream>(
    null
  );
  const remoteMediaStream = useRef<MediaStream>(new MediaStream());
  const isVoiceOnly = true;

  async function startSession() {
    // Get an ephemeral key from the Supabase Edge Function:
    const { data, error } = await supabase.functions.invoke('token');
    if (error) throw error;
    const EPHEMERAL_KEY = data.client_secret.value;
    console.log('token response', EPHEMERAL_KEY);

    // Enable audio
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    // Create a peer connection
    const pc = new RTCPeerConnection();
    // Set up some event listeners
    pc.addEventListener('connectionstatechange', (e) => {
      console.log('connectionstatechange', e);
    });
    pc.addEventListener('track', (event) => {
      if (event.track) remoteMediaStream.current.addTrack(event.track);
    });

    // Add local audio track for microphone input in the browser
    const ms = await mediaDevices.getUserMedia({
      audio: true,
    });
    if (isVoiceOnly) {
      let videoTrack = await ms.getVideoTracks()[0];
      if (videoTrack) videoTrack.enabled = false;
    }

    setLocalMediaStream(ms);
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel('oai-events');
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);

    const baseUrl = 'https://api.openai.com/v1/realtime';
    const model = 'gpt-4o-realtime-preview-2024-12-17';
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: 'POST',
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        'Content-Type': 'application/sdp',
      },
    });

    const answer = {
      type: 'answer',
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener('message', (e) => {
        console.log('dataChannel message', JSON.parse(e.data));
        setEvents((prev) => [JSON.parse(e.data), ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener('open', () => {
        setIsSessionActive(true);
        setEvents([]);
      });
    }
  }, [dataChannel]);

  return (
    <>
      <StatusBar style="auto" />
      <SafeAreaView style={styles.container}>
        <View>
          {!isSessionActive ? (
            <Button
              title="Start"
              onPress={startSession}
              disabled={isSessionActive}
            />
          ) : (
            <Button
              title="Stop"
              onPress={stopSession}
              disabled={!isSessionActive}
            />
          )}
          <RTCView stream={remoteMediaStream.current} />
        </View>
        <View>
          {isSessionActive && (
            <AudioVizDOMComponent
              dom={{ matchContents: true }}
              audio={remoteMediaStream.current}
            />
          )}
        </View>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
});

export default App;

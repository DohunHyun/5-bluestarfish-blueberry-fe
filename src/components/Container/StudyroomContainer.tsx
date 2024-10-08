import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import kurentoUtils from "kurento-utils";
import Participant from "../../utils/Participant";
import { useDeviceStore, useLoginedUserStore } from "../../store/store";
import { useUserStore } from "../../store/userStore";
import { useRoomStore } from "../../store/roomStore";
import axiosInstance from "../../utils/axiosInstance";
import { checkMediaPermissions } from "../../utils/checkMediaPermission";

const StudyroomContainer: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const {
    camEnabled,
    micEnabled,
    speakerEnabled,
    toggleCam,
    toggleMic,
    toggleSpeaker,
  } = useDeviceStore();
  const { userId, nickname } = useLoginedUserStore();
  const { users, addUser, updateUser, removeUser } = useUserStore();
  const {
    curUsers,
    setRoomId,
    setTitle,
    setMaxUsers,
    setCurUsers,
    setCamEnabled,
  } = useRoomStore();
  const [cameraEnabled, setCameraEnabled] = useState<boolean>(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState<boolean>(false);
  const [permissionsChecked, setPermissionsChecked] = useState<boolean>(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const participantsRef = useRef<Record<string, Participant>>({}); // Ref로 관리
  const usersRef = useRef(users); // users 상태를 유지하는 Ref

  useEffect(() => {
    usersRef.current = users; // users 상태가 변경될 때마다 usersRef 업데이트
  }, [users]);

  useEffect(() => {
    fetchStudyRoom();
    checkPermissions();
    return () => {
      cleanupStream();
    };
  }, []);

  useEffect(() => {
    if (permissionsChecked) {
      if (!cameraEnabled || !microphoneEnabled) {
        navigate(-1);
      }
    }
  }, [permissionsChecked]);

  useEffect(() => {
    if (permissionsChecked) {
      wsRef.current = new WebSocket(`${process.env.REACT_APP_SOCKET_RTC_URL}`);

      wsRef.current.onopen = () => {
        console.log("WebSocket connection established");
        register(); // WebSocket이 OPEN 상태가 된 후 register 호출
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error: ", error);
      };
    }
    // 핑퐁 START ----------------------------------------------------------
    const interval = setInterval(() => {
      const message = {
        id: "pingPong",
        message: "ping",
      };
      sendMessage(message);
    }, 10000);
    // 핑퐁 START ----------------------------------------------------------

    return () => {
      cleanupStream();
      if (interval) clearInterval(interval);
    };
  }, [permissionsChecked]);

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.onmessage = (message) => {
        const parsedMessage = JSON.parse(message.data);

        switch (parsedMessage.id) {
          case "existingParticipants":
            onExistingParticipants(parsedMessage);
            break;
          case "newParticipantArrived":
            onNewParticipant(parsedMessage);
            break;
          case "participantLeft":
            onParticipantLeft(parsedMessage);
            break;
          case "receiveVideoAnswer":
            receiveVideoResponse(parsedMessage);
            break;
          case "iceCandidate":
            participantsRef.current[parsedMessage.name].rtcPeer.addIceCandidate(
              parsedMessage.candidate,
              (error: any) => {
                if (error) {
                  console.error("Error adding candidate: " + error);
                  return;
                }
              }
            );
            break;
          case "isCamOn":
            controlCam(parsedMessage);
            break;
          case "isMicOn":
            controlMic(parsedMessage);
            break;
          case "pingPong":
            break;
          default:
            console.error("Unrecognized message", parsedMessage);
        }
      };
    }
  }, [wsRef.current]);

  const checkPermissions = async () => {
    const { camera, microphone } = await checkMediaPermissions();
    setCameraEnabled(camera);
    setMicrophoneEnabled(microphone);
    setPermissionsChecked(true);
  };

  const cleanupStream = () => {
    Object.keys(participantsRef.current).forEach((key) => {
      const participant = participantsRef.current[key];
      if (participant.rtcPeer) {
        participant.rtcPeer.dispose(); // 피어 객체 정리
        participant.rtcPeer = null; // 피어 참조 제거
        participant.dispose();
      }
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null; // 비디오 엘리먼트에서 스트림 해제
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const exitStudyRoom = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      const response = await axiosInstance.post(
        `${process.env.REACT_APP_API_URL}/api/v1/rooms/${roomId}/users/${userId}`,
        {
          host: false,
          active: false,
          camEnabled: camEnabled,
          micEnabled: micEnabled,
          speakerEnabled: speakerEnabled,
          goalTime: "14:30:30",
          dayTime: "15:30:30",
        }
      );
      if (response.status === 204) {
        navigate(`/`);
      }
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 404) {
          console.error("404: ", "Not Found");
        } else {
          console.error(
            `오류 발생 (${error.response.status}):`,
            error.response.data.message || "서버 오류가 발생했습니다."
          );
        }
      } else {
        console.error("스터디룸 퇴장 중 오류 발생:", error.message);
      }
    } finally {
      setIsLoading(false); // 로딩 종료
    }
  };

  const fetchStudyRoom = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      const response = await axiosInstance.get(
        `${process.env.REACT_APP_API_URL}/api/v1/rooms/${roomId}`
      );
      if (response.status === 200) {
        setRoomId(response.data.data.id);
        setTitle(response.data.data.title);
        setMaxUsers(response.data.data.maxUsers);
        setCamEnabled(response.data.data.camEnabled);
      }
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 404) {
          console.error(
            "404 오류: ",
            error.response.data.message || "스터디룸을 찾을 수 없습니다."
          );
        } else {
          console.error(
            `오류 발생 (${error.response.status}):`,
            error.response.data.message || "서버 오류가 발생했습니다."
          );
        }
      } else {
        console.error("스터디룸 정보를 가져오는 중 오류 발생:", error.message);
      }
    } finally {
      setIsLoading(false); // 로딩 종료
    }
  };

  useEffect(() => {
    const message = {
      id: "isCamOn",
      sender: nickname,
      isCamOn: camEnabled,
    };
    sendMessage(message);
    updateUser(userId, { camEnabled: camEnabled });
  }, [camEnabled]);

  useEffect(() => {
    const message = {
      id: "isMicOn",
      sender: nickname,
      isMicOn: micEnabled,
    };
    sendMessage(message);
    updateUser(userId, { micEnabled: micEnabled });
  }, [micEnabled]);

  const clickCamIcon = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !camEnabled;
      });
      toggleCam();
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }
  };

  const clickMicIcon = () => {
    localStreamRef.current
      ?.getAudioTracks()
      .forEach((track) => (track.enabled = !micEnabled));
    toggleMic();
  };

  const clickSpeakerIcon = () => {
    toggleSpeaker();
  };

  const handleExitButton = async () => {
    leaveRoom();
    await exitStudyRoom();
    cleanupStream();
    navigate("/");
  };

  const controlCam = (parsedMessage: any) => {
    const videoElement = document.getElementById(
      `video-${parsedMessage.sender}`
    );

    if (videoElement) {
      videoElement.style.visibility = parsedMessage.isCamOn
        ? "visible"
        : "hidden";
    } else {
      console.error(
        `Video element with id video-${parsedMessage.sender} not found`
      );
    }

    const userToUpdate = usersRef.current.find(
      (user) => user.nickname === parsedMessage.sender
    );

    if (userToUpdate) {
      updateUser(userToUpdate.id, { camEnabled: parsedMessage.isCamOn });
    } else {
      console.error(`User with nickname ${parsedMessage.sender} not found`);
    }
  };

  const controlMic = (parsedMessage: any) => {
    const videoElement = document.getElementById(
      `video-${parsedMessage.sender}`
    ) as HTMLVideoElement | null;

    if (videoElement) {
      videoElement.muted = !parsedMessage.isMicOn;
    } else {
      console.error(
        `Video element with id video-${parsedMessage.sender} not found`
      );
    }
    const userToUpdate = usersRef.current.find(
      (user) => user.nickname === parsedMessage.sender
    );

    if (userToUpdate) {
      updateUser(userToUpdate.id, { micEnabled: parsedMessage.isMicOn });
    } else {
      console.error(`User with nickname ${parsedMessage.sender} not found`);
    }
  };

  const sendMessage = (message: any) => {
    const jsonMessage = JSON.stringify(message);
    wsRef.current?.send(jsonMessage);
  };

  const register = () => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      });

    const message = {
      id: "joinRoom",
      userId: userId,
      name: nickname,
      room: roomId,
      camEnabled: camEnabled,
      micEnabled: micEnabled,
      speakerEnabled: speakerEnabled,
    };
    sendMessage(message);
  };

  const onNewParticipant = (request: {
    userId: number;
    profileImage: string;
    name: string;
    camEnabled: boolean;
    micEnabled: boolean;
    speakerEnabled: boolean;
  }) => {
    receiveVideo(request.name);

    addUser({
      id: request.userId,
      nickname: request.name,
      profileImage: request.profileImage,
      camEnabled: request.camEnabled,
      micEnabled: request.micEnabled,
      speakerEnabled: request.speakerEnabled,
    });
  };

  const receiveVideoResponse = (result: {
    userId: number;
    profileImage: string;
    name: string;
    camEnabled: boolean;
    micEnabled: boolean;
    speakerEnabled: boolean;
    sdpAnswer: any;
  }) => {
    const participant = participantsRef.current[result.name];
    if (participant) {
      participant.rtcPeer.processAnswer(result.sdpAnswer, (error: any) => {
        if (error) {
          console.error("Error processing SDP answer:", error);
        }
      });
    }

    const existingUser = usersRef.current.find(
      (user) => user.id === result.userId
    );

    if (existingUser) {
      updateUser(result.userId, {
        profileImage: result.profileImage,
        nickname: result.name,
        camEnabled: result.camEnabled,
        micEnabled: result.micEnabled,
        speakerEnabled: result.speakerEnabled,
      });
    } else {
      addUser({
        id: result.userId,
        profileImage: result.profileImage,
        nickname: result.name,
        camEnabled: result.camEnabled,
        micEnabled: result.micEnabled,
        speakerEnabled: result.speakerEnabled,
      });
    }
  };

  const stop = () => {
    for (const key in participantsRef.current) {
      const participant = participantsRef.current[key];
      if (participant.rtcPeer) {
        participant.rtcPeer.dispose();
        participant.rtcPeer = null;
      }
    }

    wsRef.current?.close();
  };

  const onExistingParticipants = (msg: { data: string[] }) => {
    const constraints = {
      audio: true,
      video: {
        mandatory: {
          maxWidth: 400,
          maxFrameRate: 120,
          minFrameRate: 15,
        },
      },
    };
    const participant = new Participant(nickname, nickname, sendMessage);
    participantsRef.current[nickname] = participant;
    setCurUsers(Object.keys(participantsRef.current).length);
    const video = participant.getVideoElement();

    const options = {
      localVideo: video,
      mediaConstraints: constraints,
      onicecandidate: participant.onIceCandidate.bind(participant),
      configuration: {
        iceServers: [
          {
            urls: `${process.env.REACT_APP_TURN_URL}`,
            username: "blueberry",
            credential: "1234",
          },
        ],
      },
    };

    participant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(
      options,
      (error: any) => {
        if (error) {
          return console.error(error);
        }
        participant.rtcPeer.generateOffer(
          participant.offerToReceiveVideo.bind(participant)
        );
      }
    );

    msg.data.forEach(receiveVideo);
  };

  const leaveRoom = () => {
    sendMessage({ id: "leaveRoom" });
    Object.keys(participantsRef.current).forEach((key) => {
      const participant = participantsRef.current[key];
      if (participant.rtcPeer) {
        participant.rtcPeer.dispose();
        participant.rtcPeer = null;
        participant.dispose();
      }
    });

    wsRef.current?.close();
  };

  const receiveVideo = (sender: string) => {
    const participant = new Participant(nickname, sender, sendMessage);
    participantsRef.current[sender] = participant;
    const video = participant.getVideoElement();
    setCurUsers(Object.keys(participantsRef.current).length);
    const options = {
      remoteVideo: video,
      onicecandidate: participant.onIceCandidate.bind(participant),
      configuration: {
        iceServers: [
          {
            urls: `${process.env.REACT_APP_TURN_URL}`,
            username: "blueberry",
            credential: "1234",
          },
        ],
      },
    };

    participant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(
      options,
      (error: any) => {
        if (error) {
          return console.error(error);
        }
        participant.rtcPeer.generateOffer(
          participant.offerToReceiveVideo.bind(participant)
        );
      }
    );
  };

  const onParticipantLeft = (request: { name: string }) => {
    const participant = participantsRef.current[request.name];

    if (participant !== undefined) {
      participant.rtcPeer.dispose();
      participant.rtcPeer = null;
      participant.dispose();
      delete participantsRef.current[request.name];
    }

    const userToRemove = usersRef.current.find(
      (user) => user.nickname === request.name
    );

    if (userToRemove) {
      removeUser(userToRemove.id);
    }

    setCurUsers(Object.keys(participantsRef.current).length);
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-4">
      <span id="numUsers" className="text-white">
        {curUsers}
      </span>
      <div>
        <div
          id="container"
          className="w-full h-full flex flex-col items-center"
        >
          <h2
            id="room-header"
            className="m-0 w-full h-20 border border-black box-border flex items-center justify-center"
          ></h2>
          <div
            id="participants"
            className="w-full h-[calc(100%-80px)] border border-black flex flex-wrap items-center justify-center gap-8"
          >
            <div
              className="flex flex-col bg-cover justify-center items-center w-[400px] h-[300px] border border-black rounded-lg"
              id={nickname}
            >
              <div
                className={`w-[400x] h-[300px] bg-cover rounded-[20px] shadow-lg  ${
                  !camEnabled ? "hidden" : ""
                }`}
              >
                <video
                  id="video-나"
                  className="w-full h-full transform scale-x-[-1]"
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                />
              </div>
              <span className="text-lg text-white">{nickname}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-10 flex flex-row gap-5 justify-center items-center">
        <button onClick={clickCamIcon}>
          <img
            src={
              camEnabled
                ? `${process.env.PUBLIC_URL}/assets/images/camera-on.png`
                : `${process.env.PUBLIC_URL}/assets/images/room-cam-off.png`
            }
            alt="camera"
            className="h-[20px] mb-2"
          />
        </button>
        <button onClick={clickMicIcon}>
          <img
            src={
              micEnabled
                ? `${process.env.PUBLIC_URL}/assets/images/room-mic-on.png`
                : `${process.env.PUBLIC_URL}/assets/images/room-mic-off.png`
            }
            alt="mic"
            className="h-[28px]"
          />
        </button>
        <button onClick={clickSpeakerIcon}>
          <img
            src={
              speakerEnabled
                ? `${process.env.PUBLIC_URL}/assets/images/room-speaker-on.png`
                : `${process.env.PUBLIC_URL}/assets/images/room-speaker-off.png`
            }
            alt="speaker"
            className="w-[27px] h-[26px] mb-[2px]"
          />
        </button>
        <button onClick={handleExitButton}>
          <img
            src={`${process.env.PUBLIC_URL}/assets/images/exit-white.png`}
            alt="exit"
            className="h-[26px] mb-[1px]"
          />
        </button>
      </div>
    </div>
  );
};

export default StudyroomContainer;

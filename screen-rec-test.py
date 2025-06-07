import mss
import cv2
import numpy as np
import time
from websocket import create_connection

ws = create_connection("ws://<server-ip>:3000")

with mss.mss() as sct:
    monitor = sct.monitors[1]
    while True:
        img = np.array(sct.grab(monitor))
        frame = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

        _, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
        ws.send_binary(buffer.tobytes())
        time.sleep(0.1)  # ~10 fps

ws.close()

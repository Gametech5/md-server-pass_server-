import serial

ser = serial.Serial('/dev/ttyUSB0', 9600)
ser.write(b'a')  # triggert trilling
ser.close()

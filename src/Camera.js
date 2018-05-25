// @flow
import React from 'react';
import PropTypes from 'prop-types';
import { mapValues } from 'lodash';
import {
  findNodeHandle,
  NativeModules,
  ViewPropTypes,
  Platform,
  requireNativeComponent,
} from 'react-native';

import type { FaceFeature } from './FaceDetector';

type PictureOptions = {
  quality?: number,
  base64?: boolean,
  exif?:boolean,
  onPictureSaved?: Function,
  // internal
  id?: number,
  fastMode?: boolean,
};

type TrackedFaceFeature = FaceFeature & {
  faceID?: number,
};

type RecordingOptions = {
  maxDuration?: number,
  maxFileSize?: number,
  quality?: number | string,
};

type CapturedPicture = {
  width: number,
  height: number,
  uri: string,
  base64?: string,
  exif?: Object,
};

type RecordingResult = {
  uri: string,
};

type EventCallbackArgumentsType = {
  nativeEvent: Object,
};

type MountErrorNativeEventType = {
  message: string,
};

type PictureSavedNativeEventType = {
  data: CapturedPicture,
  id: number,
};

type PropsType = ViewPropTypes & {
  zoom?: number,
  ratio?: string,
  focusDepth?: number,
  type?: number | string,
  onCameraReady?: Function,
  onBarCodeRead?: Function,
  useCamera2Api?: boolean,
  faceDetectionMode?: number,
  flashMode?: number | string,
  barCodeTypes?: Array<string | number>,
  whiteBalance?: number | string,
  faceDetectionLandmarks?: number,
  autoFocus?: string | boolean | number,
  pictureSize?: string,
  faceDetectionClassifications?: number,
  onMountError?: MountErrorNativeEventType => void,
  onFacesDetected?: ({ faces: Array<TrackedFaceFeature> }) => void,
};

const CameraManager: Object =
  NativeModules.ExponentCameraManager || NativeModules.ExponentCameraModule;

const EventThrottleMs = 500;

const _PICTURE_SAVED_CALLBACKS = {};
let _GLOBAL_PICTURE_ID = 1;

export default class Camera extends React.Component<PropsType> {
  static Constants = {
    Type: CameraManager.Type,
    FlashMode: CameraManager.FlashMode,
    AutoFocus: CameraManager.AutoFocus,
    WhiteBalance: CameraManager.WhiteBalance,
    VideoQuality: CameraManager.VideoQuality,
    BarCodeType: CameraManager.BarCodeType,
    FaceDetection: CameraManager.FaceDetection,
  };

  // Values under keys from this object will be transformed to native options
  static ConversionTables = {
    type: CameraManager.Type,
    flashMode: CameraManager.FlashMode,
    autoFocus: CameraManager.AutoFocus,
    whiteBalance: CameraManager.WhiteBalance,
    faceDetectionMode: CameraManager.FaceDetection.Mode,
    faceDetectionLandmarks: CameraManager.FaceDetection.Landmarks,
    faceDetectionClassifications: CameraManager.FaceDetection.Classifications,
  };

  static propTypes = {
    ...ViewPropTypes,
    zoom: PropTypes.number,
    ratio: PropTypes.string,
    focusDepth: PropTypes.number,
    onMountError: PropTypes.func,
    onCameraReady: PropTypes.func,
    onBarCodeRead: PropTypes.func,
    onFacesDetected: PropTypes.func,
    useCamera2Api: PropTypes.bool,
    faceDetectionMode: PropTypes.number,
    faceDetectionLandmarks: PropTypes.number,
    faceDetectionClassifications: PropTypes.number,
    barCodeTypes: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
    type: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    flashMode: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    whiteBalance: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    autoFocus: PropTypes.oneOfType([PropTypes.string, PropTypes.number, PropTypes.bool]),
    pictureSize: PropTypes.string,
  };

  static defaultProps: Object = {
    zoom: 0,
    ratio: '4:3',
    focusDepth: 0,
    type: CameraManager.Type.back,
    autoFocus: CameraManager.AutoFocus.on,
    flashMode: CameraManager.FlashMode.off,
    whiteBalance: CameraManager.WhiteBalance.auto,
    faceDetectionMode: CameraManager.FaceDetection.fast,
    barCodeTypes: Object.values(CameraManager.BarCodeType),
    faceDetectionLandmarks: CameraManager.FaceDetection.Landmarks.none,
    faceDetectionClassifications: CameraManager.FaceDetection.Classifications.none,
  };

  _cameraRef: ?Object;
  _cameraHandle: ?number;
  _lastEvents: { [string]: string };
  _lastEventsTimes: { [string]: Date };

  constructor(props: PropsType) {
    super(props);
    this._lastEvents = {};
    this._lastEventsTimes = {};
  }

  async takePictureAsync(options?: PictureOptions): Promise<CapturedPicture> {
    if (!options) {
      options = {};
    }
    if (!options.quality) {
      options.quality = 1;
    }
    if (options.onPictureSaved) {
      const id = _GLOBAL_PICTURE_ID++;
      _PICTURE_SAVED_CALLBACKS[id] = options.onPictureSaved;
      options.id = id;
      options.fastMode = true;
    }
    return await CameraManager.takePicture(options, this._cameraHandle);
  }

  async getSupportedRatiosAsync(): Promise<Array<string>> {
    if (Platform.OS === 'android') {
      return await CameraManager.getSupportedRatios(this._cameraHandle);
    } else {
      throw new Error('Ratio is not supported on iOS');
    }
  }

  async getAvailablePictureSizesAsync(ratio?: string): Promise<Array<string>> {
    return await CameraManager.getAvailablePictureSizes(ratio, this._cameraHandle);
  }

  async recordAsync(options?: RecordingOptions): Promise<RecordingResult> {
    if (!options || typeof options !== 'object') {
      options = {};
    } else if (typeof options.quality === 'string') {
      options.quality = Camera.Constants.VideoQuality[options.quality];
    }
    return await CameraManager.record(options, this._cameraHandle);
  }

  stopRecording() {
    CameraManager.stopRecording(this._cameraHandle);
  }

  pausePreview() {
    CameraManager.pausePreview(this._cameraHandle);
  }

  resumePreview() {
    CameraManager.resumePreview(this._cameraHandle);
  }

  _onCameraReady = () => {
    if (this.props.onCameraReady) {
      this.props.onCameraReady();
    }
  };

  _onMountError = ({ nativeEvent }: { nativeEvent: MountErrorNativeEventType }) => {
    if (this.props.onMountError) {
      this.props.onMountError(nativeEvent);
    }
  };

  _onPictureSaved = ({ nativeEvent }: { nativeEvent: PictureSavedNativeEventType }) => {
    const callback = _PICTURE_SAVED_CALLBACKS[nativeEvent.id];
    if (callback) {
      callback(nativeEvent.data);
      delete _PICTURE_SAVED_CALLBACKS[nativeEvent.id];
    }
  }

  _onObjectDetected = (callback: ?Function) => ({ nativeEvent }: EventCallbackArgumentsType) => {
    const { type } = nativeEvent;
    if (
      this._lastEvents[type] &&
      this._lastEventsTimes[type] &&
      JSON.stringify(nativeEvent) === this._lastEvents[type] &&
      new Date() - this._lastEventsTimes[type] < EventThrottleMs
    ) {
      return;
    }

    if (callback) {
      callback(nativeEvent);
      this._lastEventsTimes[type] = new Date();
      this._lastEvents[type] = JSON.stringify(nativeEvent);
    }
  };

  _setReference = (ref: ?Object) => {
    if (ref) {
      this._cameraRef = ref;
      this._cameraHandle = findNodeHandle(ref);
    } else {
      this._cameraRef = null;
      this._cameraHandle = null;
    }
  };

  render() {
    const nativeProps = this._convertNativeProps(this.props);

    return (
      <ExponentCamera
        {...nativeProps}
        ref={this._setReference}
        onCameraReady={this._onCameraReady}
        onMountError={this._onMountError}
        onPictureSaved={this._onPictureSaved}
        onBarCodeRead={this._onObjectDetected(this.props.onBarCodeRead)}
        onFacesDetected={this._onObjectDetected(this.props.onFacesDetected)}
      />
    );
  }

  _convertNativeProps(props: PropsType) {
    const newProps = mapValues(props, this._convertProp);

    if (props.onBarCodeRead) {
      newProps.barCodeScannerEnabled = true;
    }

    if (props.onFacesDetected) {
      newProps.faceDetectorEnabled = true;
    }

    if (Platform.OS === 'ios') {
      delete newProps.ratio;
      delete newProps.useCamera2Api;
    }

    return newProps;
  }

  _convertProp(value: *, key: string): * {
    if (typeof value === 'string' && Camera.ConversionTables[key]) {
      return Camera.ConversionTables[key][value];
    }

    return value;
  }
}

export const Constants = Camera.Constants;

const ExponentCamera = requireNativeComponent('ExponentCamera', Camera, {
  nativeOnly: {
    onCameraReady: true,
    onMountError: true,
    onPictureSaved: true,
    onBarCodeRead: true,
    onFaceDetected: true,
    faceDetectorEnabled: true,
    barCodeScannerEnabled: true,
  },
});

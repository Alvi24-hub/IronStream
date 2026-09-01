from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime

class SensorData(BaseModel):
    """Validated sensor data model"""
    device_id: str = Field(..., min_length=3, max_length=50, description="Device identifier")
    temperature: Optional[float] = Field(None, ge=-50, le=200, description="Temperature in Celsius")
    vibration: Optional[float] = Field(None, ge=0, le=20, description="Vibration in Hz")
    timestamp: Optional[int] = Field(None, description="Unix timestamp in milliseconds")
    
    @validator('temperature')
    def validate_temperature(cls, v):
        if v is not None and (v < -50 or v > 200):
            raise ValueError('Temperature must be between -50 and 200°C')
        return v
    
    @validator('vibration')
    def validate_vibration(cls, v):
        if v is not None and (v < 0 or v > 20):
            raise ValueError('Vibration must be between 0 and 20 Hz')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "device_id": "sensor_f1_01",
                "temperature": 75.5,
                "vibration": 2.3,
                "timestamp": 1693500000000
            }
        }

class HistoricalQuery(BaseModel):
    """Validated historical query parameters"""
    device_id: Optional[str] = Field(None, min_length=3, max_length=50)
    limit: int = Field(100, ge=1, le=10000, description="Number of records to return")
    offset: int = Field(0, ge=0, description="Number of records to skip")
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    
    @validator('device_id')
    def validate_device_id(cls, v):
        if v is not None and not v.startswith('sensor_'):
            raise ValueError('Device ID must start with "sensor_"')
        return v

class ReplayQuery(BaseModel):
    """Validated replay query parameters"""
    limit: int = Field(100, ge=1, le=5000, description="Number of events to return")
    offset: int = Field(0, ge=0, description="Number of events to skip")
    device_id: Optional[str] = Field(None, min_length=3, max_length=50)

class FaultResponse(BaseModel):
    """Fault response model"""
    device_id: str
    fault_type: str
    message: str
    timestamp: str

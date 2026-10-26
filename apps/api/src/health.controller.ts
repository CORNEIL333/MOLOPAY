import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

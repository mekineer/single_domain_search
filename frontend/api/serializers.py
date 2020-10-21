from rest_framework import serializers
from app.models import *

class QueryInfoSerializer(serializers.ModelSerializer):

	class Meta:
		model = QueryInfo
		fields = ['query','url']


from rest_framework import serializers
# from rest_framework.validators import UniqueValidator
# from django.contrib.auth.models import User
from app.models import *

# class UserSerializer(serializers.ModelSerializer):
# 	email = serializers.EmailField(
# 			required=True,
# 			validators=[UniqueValidator(queryset=User.objects.all())]
# 			)
# 	username = serializers.CharField(
# 			validators=[UniqueValidator(queryset=User.objects.all())]
# 			)
# 	password = serializers.CharField(min_length=8)

# 	def save(self):
# 		user = User(username=validated_data['username'], email=validated_data['email'],
# 			)
# 		password = self.validated_data['password']
# 		user.set_password(password)
# 		user.save()

# 	class Meta:
# 		model = User
# 		fields = ('username', 'email', 'password')

# class LoginSerializer(serializers.ModelSerializer):

# 	class Meta:
# 		model = User
# 		fields = ['username', 'password']

class QueryInfoSerializer(serializers.ModelSerializer):

	class Meta:
		model = QueryInfo
		fields = ['query','url','mark']

